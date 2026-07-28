import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, prisma } from '@dex/db';
import { enrichSearchResults, isAiEnabled } from '@dex/ai';
import {
  HttpFetcher,
  TavilySearchProvider,
  extractGenericOffer,
  extractSupplyItNowPart,
} from '@dex/integrations';
import { recordJobOutcome, suggestSuppliers } from '@dex/knowledge';
import type { JobBudget } from '../budget.js';
import { AppError, ErrorCodes } from '../errors.js';
import { fetchUsdRates, parseMoney, toUsd } from '../money.js';
import { mpnsMatch, normalizeMpn } from '../mpn.js';
import { enqueue } from '../queue.js';
import { extractRegistrableDomain } from '../security/url.js';
import { appendJobEvent, setJobStatus } from '../search/service.js';

export type PipelineEnv = {
  redisUrl: string;
  tavilyApiKey: string;
  aiEnabled: boolean;
  openaiApiKey: string;
  openaiModel: string;
  artifactLocalPath: string;
  supplyItNowHosts: string[];
};

function budgetOf(job: { budgetJson: unknown }): JobBudget {
  return job.budgetJson as JobBudget;
}

async function storeArtifact(localPath: string, body: string): Promise<{ hash: string; key: string }> {
  const hash = createHash('sha256').update(body).digest('hex');
  const dir = path.resolve(localPath);
  await mkdir(dir, { recursive: true });
  const key = `${hash}.html`;
  await writeFile(path.join(dir, key), body, 'utf8');
  return { hash, key };
}

export async function runResolveStage(jobId: string, env: PipelineEnv): Promise<void> {
  const job = await prisma.searchJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === 'cancelled') return;

  await setJobStatus(jobId, 'resolving', {
    startedAt: job.startedAt ?? new Date(),
    progressJson: { stage: 'resolving', percent: 10 },
  });
  await appendJobEvent(jobId, 'Resolving part identity', { stage: 'resolving' });

  let rawMpn = job.inputValue;
  let manufacturer: string | undefined;
  let description: string | undefined;

  if (job.inputType === 'URL') {
    const fetcher = new HttpFetcher();
    const page = await fetcher.fetchText(job.inputValue);
    if (page.status >= 400) {
      throw new AppError(ErrorCodes.ExtractionError, `SupplyItNow fetch failed: HTTP ${page.status}`);
    }
    const extracted = extractSupplyItNowPart(page.body);
    if (!extracted?.mpn) {
      throw new AppError(
        ErrorCodes.ExtractionError,
        'Could not extract manufacturer part number from SupplyItNow page',
      );
    }
    rawMpn = extracted.mpn;
    manufacturer = extracted.manufacturer;
    description = extracted.description;
    await appendJobEvent(jobId, `Extracted MPN ${rawMpn}`, { stage: 'resolving' });
  }

  const normalized = normalizeMpn(rawMpn);
  if (!normalized) {
    throw new AppError(ErrorCodes.ValidationError, 'MPN is empty after normalization');
  }

  const part = await prisma.part.create({
    data: {
      rawMpn,
      normalizedMpn: normalized,
      manufacturer,
      descriptionRaw: description,
      descriptionClean: description,
    },
  });

  await prisma.searchJob.update({
    where: { id: jobId },
    data: { partId: part.id },
  });

  if (!job.forceRefresh) {
    const cache = await prisma.partSearchCache.findFirst({
      where: {
        normalizedMpn: normalized,
        expiresAt: { gt: new Date() },
        ...(job.orgId ? { orgId: job.orgId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (cache) {
      await appendJobEvent(jobId, 'Fresh MPN cache hit — cloning prior offers when available', {
        stage: 'resolving',
      });
      // Cache informs discover priority; still run discover for freshness unless we later add clone path.
    }
  }

  await enqueue(env.redisUrl, 'jobs-discover', 'discover', { jobId }, `discover-${jobId}`);
}

export async function runDiscoverStage(jobId: string, env: PipelineEnv): Promise<void> {
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: { part: true },
  });
  if (!job?.part || job.status === 'cancelled') return;

  await setJobStatus(jobId, 'discovering', {
    progressJson: { stage: 'discovering', percent: 30 },
  });
  await appendJobEvent(jobId, 'Discovering supplier candidates worldwide', { stage: 'discovering' });

  const budget = budgetOf(job);
  const suggestions = await suggestSuppliers({
    normalizedMpn: job.part.normalizedMpn,
    manufacturer: job.part.manufacturer ?? undefined,
    orgId: job.orgId ?? undefined,
    limit: 10,
  });

  if (suggestions.length) {
    await appendJobEvent(jobId, `Knowledge assist suggested ${suggestions.length} suppliers`, {
      stage: 'discovering',
      data: { domains: suggestions.map((s) => s.supplierDomain) },
    });
  }

  const provider = new TavilySearchProvider(env.tavilyApiKey);
  const queries = buildSearchQueries(job.part.normalizedMpn, job.part.manufacturer);
  const limitedQueries = queries.slice(0, budget.maxSerpQueries);

  const hits = [];
  for (const query of limitedQueries) {
    const batch = await provider.search(query, { maxResults: 8 });
    hits.push(...batch);
  }

  const knowledgeBoost = new Map(suggestions.map((s) => [s.supplierDomain, s.score]));
  const dedup = new Map<string, { url: string; domain: string; title?: string; snippet?: string; score: number }>();

  for (const hit of hits) {
    let hostname: string;
    try {
      hostname = new URL(hit.url).hostname;
    } catch {
      continue;
    }
    const domain = extractRegistrableDomain(hostname);
    if (env.supplyItNowHosts.some((h) => domain === h || hostname.endsWith(h))) continue;
    if (isLowValueDomain(domain, hit.url)) continue;

    const score =
      (hit.score ?? 0.5) + (knowledgeBoost.get(domain) ?? 0) * 0.2;
    const existing = dedup.get(hit.url);
    if (!existing || score > existing.score) {
      dedup.set(hit.url, {
        url: hit.url,
        domain,
        title: hit.title,
        snippet: hit.content,
        score,
      });
    }
  }

  // Seed preferred domains as search-style candidates using site root if no URL yet
  for (const suggestion of suggestions.filter((s) => s.preferred)) {
    const url = `https://${suggestion.supplierDomain}`;
    if (!dedup.has(url)) {
      dedup.set(url, {
        url,
        domain: suggestion.supplierDomain,
        title: suggestion.supplierDomain,
        snippet: suggestion.reasons.join('; '),
        score: suggestion.score,
      });
    }
  }

  const ranked = [...dedup.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, budget.maxCandidates);

  for (const candidate of ranked) {
    await prisma.jobCandidate.upsert({
      where: { jobId_url: { jobId, url: candidate.url } },
      create: {
        jobId,
        url: candidate.url,
        domain: candidate.domain,
        title: candidate.title,
        snippet: candidate.snippet,
        sourceType: 'search',
        score: candidate.score,
        status: 'pending',
      },
      update: {
        score: candidate.score,
        title: candidate.title,
        snippet: candidate.snippet,
      },
    });
  }

  await appendJobEvent(jobId, `Queued ${ranked.length} candidates for extraction`, {
    stage: 'discovering',
  });

  await enqueue(env.redisUrl, 'jobs-extract', 'extract', { jobId }, `extract-${jobId}`);
}

function buildSearchQueries(mpn: string, manufacturer?: string | null): string[] {
  const base = [`"${mpn}" buy`, `"${mpn}" distributor`, `"${mpn}" price`];
  if (manufacturer) {
    base.push(`"${mpn}" "${manufacturer}" buy`);
  }
  base.push(`"${mpn}" supplier Europe`);
  base.push(`"${mpn}" supplier Asia`);
  return base;
}

function isLowValueDomain(domain: string, url: string): boolean {
  const blocked = [
    'youtube.com',
    'facebook.com',
    'twitter.com',
    'linkedin.com',
    'wikipedia.org',
    'reddit.com',
    'pinterest.com',
  ];
  if (blocked.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  const lower = url.toLowerCase();
  if (lower.endsWith('.pdf')) return true;
  if (lower.includes('datasheet') && !lower.includes('buy') && !lower.includes('cart')) {
    // Keep some datasheet sites out of extract budget — they rarely have live prices
    if (domain.includes('datasheet')) return true;
  }
  return false;
}

export async function runExtractStage(jobId: string, env: PipelineEnv): Promise<void> {
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: { part: true, candidates: { where: { status: 'pending' }, orderBy: { score: 'desc' } } },
  });
  if (!job?.part || job.status === 'cancelled') return;

  await setJobStatus(jobId, 'extracting', {
    progressJson: { stage: 'extracting', percent: 55 },
  });
  await appendJobEvent(jobId, `Extracting offers from ${job.candidates.length} candidates`, {
    stage: 'extracting',
  });

  const budget = budgetOf(job);
  const fetcher = new HttpFetcher();
  const candidates = job.candidates.slice(0, budget.maxCandidates);

  for (const candidate of candidates) {
    await prisma.jobCandidate.update({
      where: { id: candidate.id },
      data: { status: 'extracting' },
    });

    try {
      const page = await fetcher.fetchText(candidate.url);
      if (page.status >= 400) {
        await prisma.jobCandidate.update({
          where: { id: candidate.id },
          data: { status: 'failed', errorMessage: `HTTP ${page.status}` },
        });
        continue;
      }

      const artifact = await storeArtifact(env.artifactLocalPath, page.body);
      const draft = extractGenericOffer(page.body, job.part.rawMpn);
      const candidateMpn = draft.mpn ?? '';
      const exact = candidateMpn ? mpnsMatch(candidateMpn, job.part.normalizedMpn) : false;
      // Also accept if page text clearly contains normalized MPN
      const bodyHasMpn = normalizeMpn(page.body).includes(job.part.normalizedMpn);

      if (!exact && !bodyHasMpn) {
        await prisma.jobCandidate.update({
          where: { id: candidate.id },
          data: { status: 'rejected', errorMessage: 'MPN mismatch' },
        });
        continue;
      }

      const supplier = await prisma.supplier.upsert({
        where: { domain: candidate.domain },
        create: {
          domain: candidate.domain,
          name: draft.supplierName ?? candidate.domain,
          website: `https://${candidate.domain}`,
          country: draft.country ?? guessCountry(candidate.domain),
        },
        update: {
          name: draft.supplierName ?? undefined,
          country: draft.country ?? undefined,
        },
      });

      await prisma.jobSupplier.upsert({
        where: { jobId_supplierId: { jobId, supplierId: supplier.id } },
        create: { jobId, supplierId: supplier.id },
        update: {},
      });

      const parsed = draft.priceText ? parseMoney(draft.priceText, draft.currency ?? 'USD') : null;

      await prisma.offer.upsert({
        where: { jobId_productUrl: { jobId, productUrl: page.finalUrl || candidate.url } },
        create: {
          jobId,
          supplierId: supplier.id,
          mpn: exact ? candidateMpn || job.part.rawMpn : job.part.rawMpn,
          manufacturer: draft.manufacturer ?? job.part.manufacturer,
          productUrl: page.finalUrl || candidate.url,
          price: parsed ? new Prisma.Decimal(parsed.amount) : null,
          currency: parsed?.currency ?? draft.currency ?? null,
          stockQuantity: draft.stockQuantity ?? null,
          leadTime: draft.leadTime ?? null,
          moq: draft.moq ?? null,
          sourceType: 'scrape',
          matchConfidence: exact ? 1 : 0.7,
          possibleMatch: !exact,
          description: draft.description,
          artifactHash: artifact.hash,
          artifactKey: artifact.key,
          extractedAt: new Date(),
        },
        update: {
          price: parsed ? new Prisma.Decimal(parsed.amount) : null,
          currency: parsed?.currency ?? draft.currency ?? null,
          stockQuantity: draft.stockQuantity ?? null,
          leadTime: draft.leadTime ?? null,
          matchConfidence: exact ? 1 : 0.7,
          possibleMatch: !exact,
          description: draft.description,
          artifactHash: artifact.hash,
          artifactKey: artifact.key,
          extractedAt: new Date(),
        },
      });

      await prisma.jobCandidate.update({
        where: { id: candidate.id },
        data: { status: 'extracted' },
      });
    } catch (error) {
      await prisma.jobCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'extract failed',
        },
      });
    }
  }

  await enqueue(env.redisUrl, 'jobs-normalize', 'normalize', { jobId }, `normalize-${jobId}`);
}

function guessCountry(domain: string): string | null {
  const tld = domain.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    cn: 'CN',
    de: 'DE',
    jp: 'JP',
    kr: 'KR',
    tw: 'TW',
    uk: 'GB',
    fr: 'FR',
    it: 'IT',
    in: 'IN',
    ca: 'CA',
    mx: 'MX',
    sg: 'SG',
    us: 'US',
    com: null as unknown as string,
  };
  if (!tld) return null;
  const value = map[tld];
  return value ?? null;
}

export async function runNormalizeStage(jobId: string, _env: PipelineEnv): Promise<void> {
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: { offers: true, part: true },
  });
  if (!job || job.status === 'cancelled') return;

  await setJobStatus(jobId, 'normalizing', {
    progressJson: { stage: 'normalizing', percent: 75 },
  });
  await appendJobEvent(jobId, 'Normalizing currencies to USD and ranking', { stage: 'normalizing' });

  const currencies = job.offers
    .map((o) => o.currency)
    .filter((c): c is string => Boolean(c));
  const rates = await fetchUsdRates(currencies);
  const asOf = new Date();

  for (const [currency, usdRate] of rates) {
    if (currency === 'USD') continue;
    await prisma.exchangeRate.create({
      data: {
        base: currency,
        quote: 'USD',
        rate: new Prisma.Decimal(usdRate),
        asOf,
        source: 'frankfurter',
      },
    }).catch(() => {
      // unique conflicts are fine
    });
  }

  // Dedupe suppliers already domain-unique; keep lowest USD per supplier
  const bySupplier = new Map<string, typeof job.offers>();
  for (const offer of job.offers) {
    const list = bySupplier.get(offer.supplierId) ?? [];
    list.push(offer);
    bySupplier.set(offer.supplierId, list);
  }

  for (const offer of job.offers) {
    let priceUsd: number | null = null;
    if (offer.price != null && offer.currency) {
      priceUsd = toUsd(Number(offer.price), offer.currency, rates);
    }
    await prisma.offer.update({
      where: { id: offer.id },
      data: { priceUsd: priceUsd == null ? null : new Prisma.Decimal(priceUsd) },
    });
  }

  // Drop more expensive duplicates per supplier (keep best USD / freshest)
  for (const [, offers] of bySupplier) {
    const ranked = [...offers].sort((a, b) => {
      const aUsd = a.priceUsd == null ? Number.POSITIVE_INFINITY : Number(a.priceUsd);
      const bUsd = b.priceUsd == null ? Number.POSITIVE_INFINITY : Number(b.priceUsd);
      return aUsd - bUsd;
    });
    for (const extra of ranked.slice(1)) {
      await prisma.offer.delete({ where: { id: extra.id } });
    }
  }

  const remaining = await prisma.offer.count({ where: { jobId } });
  await prisma.searchJob.update({
    where: { id: jobId },
    data: { offerCount: remaining },
  });

  // Update cache
  if (job.part) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const existing = await prisma.partSearchCache.findFirst({
      where: {
        normalizedMpn: job.part.normalizedMpn,
        manufacturer: job.part.manufacturer,
        ...(job.orgId ? { orgId: job.orgId } : {}),
      },
    });
    if (existing) {
      await prisma.partSearchCache.update({
        where: { id: existing.id },
        data: {
          payloadJson: { jobId, offerCount: remaining },
          sourceJobId: jobId,
          expiresAt,
        },
      });
    } else {
      await prisma.partSearchCache.create({
        data: {
          orgId: job.orgId,
          normalizedMpn: job.part.normalizedMpn,
          manufacturer: job.part.manufacturer,
          payloadJson: { jobId, offerCount: remaining },
          sourceJobId: jobId,
          expiresAt,
        },
      });
    }
  }

  await enqueue(_env.redisUrl, 'jobs-enrich', 'enrich', { jobId }, `enrich-${jobId}`);
}

export async function runEnrichStage(jobId: string, env: PipelineEnv): Promise<void> {
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: {
      part: true,
      offers: { include: { supplier: true }, orderBy: { priceUsd: 'asc' } },
      candidates: true,
    },
  });
  if (!job || job.status === 'cancelled') return;

  await setJobStatus(jobId, 'enriching', {
    progressJson: { stage: 'enriching', percent: 90 },
  });

  let summary: string | undefined;
  if (isAiEnabled({ AI_ENABLED: env.aiEnabled ? 'true' : 'false', OPENAI_API_KEY: env.openaiApiKey })) {
    await appendJobEvent(jobId, 'Running AI enrichment (gray-zone / summary)', { stage: 'enriching' });
    try {
      const result = await enrichSearchResults({
        apiKey: env.openaiApiKey,
        model: env.openaiModel,
        mpn: job.part?.rawMpn ?? job.inputValue,
        manufacturer: job.part?.manufacturer,
        offers: job.offers.map((o, index) => ({
          index,
          supplier: o.supplier.name ?? o.supplier.domain,
          country: o.supplier.country,
          priceUsd: o.priceUsd == null ? null : Number(o.priceUsd),
          description: o.description,
          productUrl: o.productUrl,
        })),
      });
      summary = result.summary;
      if (job.part && result.cleanedDescription) {
        await prisma.part.update({
          where: { id: job.part.id },
          data: { descriptionClean: result.cleanedDescription },
        });
      }
      for (const idx of result.suspiciousOfferIndexes) {
        const offer = job.offers[idx];
        if (!offer) continue;
        const flags = Array.from(new Set([...(offer.riskFlags ?? []), 'ai_suspicious']));
        await prisma.offer.update({
          where: { id: offer.id },
          data: { riskFlags: flags },
        });
      }
      await appendJobEvent(jobId, 'AI enrichment complete', {
        stage: 'enriching',
        data: { notes: result.notes },
      });
    } catch (error) {
      await appendJobEvent(jobId, `AI enrichment skipped: ${error instanceof Error ? error.message : 'error'}`, {
        stage: 'enriching',
        level: 'warn',
      });
    }
  } else {
    await appendJobEvent(jobId, 'AI disabled — skipping enrichment', { stage: 'enriching' });
  }

  const failed = job.candidates.some((c) => c.status === 'failed');
  const status = job.offers.length === 0 ? 'failed' : failed ? 'completed_with_errors' : 'completed';

  await setJobStatus(jobId, status, {
    finishedAt: new Date(),
    offerCount: job.offers.length,
    summaryJson: {
      summary:
        summary ??
        `${job.offers.length} offers from ${new Set(job.offers.map((o) => o.supplierId)).size} suppliers`,
      offerCount: job.offers.length,
    },
    progressJson: { stage: status, percent: 100 },
    ...(job.offers.length === 0
      ? {
          errorCode: ErrorCodes.ExtractionError,
          errorMessage: 'No matching supplier offers found',
        }
      : {}),
  });

  await appendJobEvent(jobId, `Job ${status}`, { stage: status });
  await enqueue(env.redisUrl, 'jobs-knowledge', 'knowledge', { jobId }, `knowledge-${jobId}`);
}

export async function runKnowledgeStage(jobId: string): Promise<void> {
  await recordJobOutcome(jobId);
  await appendJobEvent(jobId, 'Supplier knowledge base updated', { stage: 'knowledge' });
}
