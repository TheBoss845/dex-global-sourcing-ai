import { prisma } from '@dex/db';
import { SCORING_VERSION, scoreSupplier, type KnowledgeSuggestion } from './scoring.js';

export async function suggestSuppliers(input: {
  normalizedMpn: string;
  manufacturer?: string;
  orgId?: string;
  limit?: number;
}): Promise<KnowledgeSuggestion[]> {
  const limit = input.limit ?? 10;

  const mpnStats = await prisma.supplierMpnStat.findMany({
    where: { normalizedMpn: input.normalizedMpn },
    include: {
      profile: {
        include: { supplier: true },
      },
    },
    take: 50,
  });

  const suggestions: KnowledgeSuggestion[] = [];
  for (const stat of mpnStats) {
    const profile = stat.profile;
    if (input.orgId && profile.orgId && profile.orgId !== input.orgId) continue;
    const { score, reasons } = scoreSupplier({
      preferred: profile.preferred,
      reliabilityScore: profile.reliabilityScore,
      mpnSuccessCount: stat.successCount,
      searchFrequency: profile.searchFrequency,
      avgResponseQuality: profile.avgResponseQuality,
    });
    suggestions.push({
      supplierDomain: profile.supplier.domain,
      score,
      reasons,
      preferred: profile.preferred,
    });
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function recordJobOutcome(jobId: string): Promise<void> {
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: {
      part: true,
      offers: { include: { supplier: true } },
      candidates: true,
    },
  });
  if (!job || !job.part) return;

  const byDomain = new Map<string, typeof job.offers>();
  for (const offer of job.offers) {
    const list = byDomain.get(offer.supplier.domain) ?? [];
    list.push(offer);
    byDomain.set(offer.supplier.domain, list);
  }

  for (const [, offers] of byDomain) {
    const supplier = offers[0]!.supplier;
    const profile = await prisma.supplierProfile.upsert({
      where: { supplierId: supplier.id },
      create: {
        orgId: job.orgId,
        supplierId: supplier.id,
        countriesServed: supplier.country ? [supplier.country] : [],
        successCount: 1,
        searchFrequency: 1,
        reliabilityScore: 0.6,
        healthStatus: 'healthy',
        lastSuccessAt: new Date(),
        avgResponseQuality: qualityForOffers(offers),
        scoringVersion: SCORING_VERSION,
      },
      update: {
        successCount: { increment: 1 },
        searchFrequency: { increment: 1 },
        lastSuccessAt: new Date(),
        healthStatus: 'healthy',
        reliabilityScore: 0.6,
        avgResponseQuality: qualityForOffers(offers),
        countriesServed: supplier.country ? [supplier.country] : undefined,
      },
    });

    if (job.part.manufacturer) {
      await prisma.supplierManufacturer.upsert({
        where: {
          profileId_manufacturer: {
            profileId: profile.id,
            manufacturer: job.part.manufacturer,
          },
        },
        create: {
          profileId: profile.id,
          manufacturer: job.part.manufacturer,
          hitCount: 1,
        },
        update: { hitCount: { increment: 1 } },
      });
    }

    await prisma.supplierMpnStat.upsert({
      where: {
        profileId_normalizedMpn: {
          profileId: profile.id,
          normalizedMpn: job.part.normalizedMpn,
        },
      },
      create: {
        profileId: profile.id,
        normalizedMpn: job.part.normalizedMpn,
        successCount: 1,
        lastSuccessAt: new Date(),
      },
      update: {
        successCount: { increment: 1 },
        lastSuccessAt: new Date(),
      },
    });

    for (const offer of offers) {
      if (offer.price == null || !offer.currency) continue;
      await prisma.supplierPriceObservation.create({
        data: {
          profileId: profile.id,
          normalizedMpn: job.part.normalizedMpn,
          price: offer.price,
          currency: offer.currency,
          priceUsd: offer.priceUsd,
          jobId: job.id,
          observedAt: offer.extractedAt,
        },
      });
    }
  }

  // Record failures for domains that never produced offers
  const failedDomains = new Set(
    job.candidates.filter((c) => c.status === 'failed').map((c) => c.domain),
  );
  for (const domain of failedDomains) {
    if (byDomain.has(domain)) continue;
    const supplier = await prisma.supplier.findUnique({ where: { domain } });
    if (!supplier) continue;
    await prisma.supplierProfile.upsert({
      where: { supplierId: supplier.id },
      create: {
        orgId: job.orgId,
        supplierId: supplier.id,
        failureCount: 1,
        searchFrequency: 1,
        reliabilityScore: 0.4,
        healthStatus: 'degraded',
        lastFailureAt: new Date(),
        scoringVersion: SCORING_VERSION,
      },
      update: {
        failureCount: { increment: 1 },
        searchFrequency: { increment: 1 },
        lastFailureAt: new Date(),
        healthStatus: 'degraded',
        reliabilityScore: 0.4,
      },
    });
  }

  await prisma.knowledgeEvent.create({
    data: {
      jobId,
      eventType: 'job_outcome_recorded',
      summary: `Learned from ${byDomain.size} suppliers`,
      dataJson: { supplierCount: byDomain.size, offerCount: job.offers.length },
    },
  });
}

function qualityForOffers(
  offers: Array<{
    price: unknown;
    currency: string | null;
    stockQuantity: number | null;
    leadTime: string | null;
    moq: number | null;
  }>,
): number {
  if (offers.length === 0) return 0;
  let total = 0;
  for (const offer of offers) {
    let score = 0;
    if (offer.price != null) score += 0.4;
    if (offer.currency) score += 0.2;
    if (offer.stockQuantity != null) score += 0.2;
    if (offer.leadTime) score += 0.1;
    if (offer.moq != null) score += 0.1;
    total += score;
  }
  return total / offers.length;
}

export * from './scoring.js';
