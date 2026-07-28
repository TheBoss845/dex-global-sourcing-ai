import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, prisma } from '@dex/db';
import { enrichSearchResults, isAiEnabled } from '@dex/ai';
import {
  TavilySearchProvider,
  extractGenericOffer,
  extractProductIdentity,
  extractSupplyItNowPart,
} from '@dex/integrations';
import { recordJobOutcome, suggestSuppliers } from '@dex/knowledge';
import type { JobBudget } from '../budget.js';
import { AppError, ErrorCodes } from '../errors.js';
import { identifyManufacturerPartNumber } from '../identity/identify-mpn.js';
import { fetchUsdRates, parseMoney, toUsd } from '../money.js';
import { mpnsMatch, normalizeMpn } from '../mpn.js';
import { enqueue } from '../queue.js';
import { safeFetchText } from '../security/safe-fetch.js';
import { extractRegistrableDomain } from '../security/url.js';
import { appendJobEvent, setJobStatus } from '../search/service.js';

export type PipelineEnv = {
  redisUrl: string;
  tavilyApiKey: string;
  aiEnabled: boolean;
  openaiApiKey: string;
  openaiModel: string;
  artifactLocalPath: string;
  resultLimit: number;
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

  const sourceUrl = job.rawSourceUrl ?? job.inputValue;

  await setJobStatus(jobId, 'validating', {
    startedAt: job.startedAt ?? new Date(),
    progressJson: { stage: 'validating', percent: 5 },
  });
  await appendJobEvent(jobId, 'Validating product-page URL', { stage: 'validating' });

  await setJobStatus(jobId, 'fetching_source', {
    progressJson: { stage: 'fetching_source', percent: 12 },
  });
  await appendJobEvent(jobId, 'Fetching source product page (HTTP-first)', {
    stage: 'fetching_source',
  });

  const page = await safeFetchText(sourceUrl, {
    timeoutMs: 15_000,
    maxBytes: 2_000_000,
    maxRedirects: 5,
  });

  if (page.status >= 400) {
    throw new AppError(
      ErrorCodes.ExtractionError,
      `Source page fetch failed: HTTP ${page.status}`,
    );
  }

  const artifact = await storeArtifact(env.artifactLocalPath, page.body);

  await prisma.searchJob.update({
    where: { id: jobId },
    data: {
      finalSourceUrl: page.finalUrl,
      sourceFetchMethod: 'http',
      sourceArtifactHash: artifact.hash,
      sourceArtifactKey: artifact.key,
    },
  });

  await setJobStatus(jobId, 'extracting_identity', {
    progressJson: { stage: 'extracting_identity', percent: 20 },
  });
  await appendJobEvent(jobId, 'Extracting product identity from source page', {
    stage: 'extracting_identity',
  });

  // Optional site hint: SupplyItNow adapter seeds evidence when applicable.
  let adapterSeed: Parameters<typeof extractProductIdentity>[1];
  try {
    const host = new URL(page.finalUrl).hostname.toLowerCase();
    if (host.includes('supplyitnow.com')) {
      const sin = extractSupplyItNowPart(page.body);
      if (sin?.mpn) {
        adapterSeed = {
          adapterDraft: {
            mpn: sin.mpn,
            manufacturer: sin.manufacturer,
            title: sin.description,
            description: sin.description,
            evidence: [
              {
                value: sin.mpn,
                classification: 'mpn',
                source: 'adapter',
                path: 'supplyitnow.mpn',
                score: 0.9,
              },
            ],
            method: 'adapter:supplyitnow',
          },
          method: 'adapter:supplyitnow',
        };
      }
    }
  } catch {
    // ignore adapter seed failures
  }

  const identity = extractProductIdentity(page.body, {
    ...adapterSeed,
    pageUrl: sourceUrl,
    finalUrl: page.finalUrl,
  });

  await setJobStatus(jobId, 'identifying_mpn', {
    progressJson: { stage: 'identifying_mpn', percent: 28 },
  });
  await appendJobEvent(jobId, 'Identifying manufacturer part number', {
    stage: 'identifying_mpn',
  });

  const identified = identifyManufacturerPartNumber({
    mpn: identity.mpn,
    manufacturer: identity.manufacturer,
    brand: identity.brand,
    supplierSku: identity.supplierSku,
    modelNumber: identity.modelNumber,
    title: identity.title,
    description: identity.description,
    evidence: identity.evidence,
    method: identity.method,
  });

  if ('failed' in identified && identified.failed) {
    await prisma.searchJob.update({
      where: { id: jobId },
      data: {
        resolveStatus: 'failed',
        identificationConfidence: identified.confidence,
        identificationMethod: identity.method,
        status: 'failed',
        finishedAt: new Date(),
        errorCode: ErrorCodes.ExtractionError,
        errorMessage: identified.reason,
        progressJson: { stage: 'failed', percent: 100 },
        summaryJson: {
          resolveFailed: true,
          reason: identified.reason,
          evidence: identified.evidence.slice(0, 12),
        },
      },
    });
    await appendJobEvent(jobId, identified.reason, {
      stage: 'identifying_mpn',
      level: 'error',
    });
    return;
  }

  if ('failed' in identified) return;

  const part = await prisma.part.create({
    data: {
      rawMpn: identified.originalMpn,
      originalMpn: identified.originalMpn,
      normalizedMpn: identified.normalizedMpn,
      manufacturer:
        identified.manufacturer ||
        identified.brand ||
        brandHintFromUrl(page.finalUrl || sourceUrl),
      brand: identified.brand || identified.manufacturer,
      modelNumber: identified.modelNumber,
      supplierSku: identified.supplierSku,
      title: identified.title,
      descriptionRaw: identified.description,
      descriptionClean: identified.description,
      identificationEvidence: {
        chosen: identified.chosenEvidence,
        all: identified.evidence.slice(0, 40),
        method: identified.method,
        confidence: identified.confidence,
      },
    },
  });

  await prisma.searchJob.update({
    where: { id: jobId },
    data: {
      partId: part.id,
      resolveStatus: 'identified',
      identificationConfidence: identified.confidence,
      identificationMethod: identified.method,
    },
  });

  await appendJobEvent(
    jobId,
    `Identified MPN ${identified.originalMpn}${identified.manufacturer ? ` (${identified.manufacturer})` : ''} · confidence ${identified.confidence.toFixed(2)}`,
    {
      stage: 'identifying_mpn',
      data: { normalizedMpn: identified.normalizedMpn, confidence: identified.confidence },
    },
  );

  if (!job.forceRefresh) {
    const cache = await prisma.partSearchCache.findFirst({
      where: {
        normalizedMpn: identified.normalizedMpn,
        expiresAt: { gt: new Date() },
        ...(job.orgId ? { orgId: job.orgId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (cache) {
      await appendJobEvent(jobId, 'Fresh MPN cache available — continuing discovery for freshness', {
        stage: 'identifying_mpn',
      });
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
    progressJson: { stage: 'discovering', percent: 40 },
  });
  await appendJobEvent(jobId, 'Searching worldwide for exact MPN suppliers (best-effort)', {
    stage: 'discovering',
  });

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

  const sourceHost = job.finalSourceUrl ? new URL(job.finalSourceUrl).hostname.toLowerCase() : '';
  const knowledgeBoost = new Map(suggestions.map((s) => [s.supplierDomain, s.score]));
  const dedup = new Map<
    string,
    { url: string; domain: string; title?: string; snippet?: string; score: number }
  >();

  for (const hit of hits) {
    let hostname: string;
    try {
      hostname = new URL(hit.url).hostname;
    } catch {
      continue;
    }
    const domain = extractRegistrableDomain(hostname);
    if (sourceHost && (hostname === sourceHost || hostname.endsWith(`.${extractRegistrableDomain(sourceHost)}`))) {
      // Allow other sellers on same marketplace domain; skip exact same host path later via URL dedupe
    }
    if (isLowValueDomain(domain, hit.url)) continue;

    const score = (hit.score ?? 0.5) + (knowledgeBoost.get(domain) ?? 0) * 0.2;
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

  const ranked = [...dedup.values()].sort((a, b) => b.score - a.score).slice(0, budget.maxCandidates);

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

  // Always include the original source product page as a candidate so the user
  // sees at least the supplier they started from when it validates.
  if (job.finalSourceUrl || job.rawSourceUrl) {
    const source = job.finalSourceUrl || job.rawSourceUrl!;
    try {
      const hostname = new URL(source).hostname;
      const domain = extractRegistrableDomain(hostname);
      await prisma.jobCandidate.upsert({
        where: { jobId_url: { jobId, url: source } },
        create: {
          jobId,
          url: source,
          domain,
          title: 'Original source product page',
          snippet: 'Seeded from user-provided URL',
          sourceType: 'scrape',
          score: 1.5,
          status: 'pending',
        },
        update: {
          score: 1.5,
          status: 'pending',
        },
      });
    } catch {
      // ignore bad source URL seeding
    }
  }

  await enqueue(env.redisUrl, 'jobs-extract', 'extract', { jobId }, `extract-${jobId}`);
}

function buildSearchQueries(mpn: string, manufacturer?: string | null): string[] {
  const base = [
    `"${mpn}" buy`,
    `"${mpn}" distributor`,
    `"${mpn}" price datasheet -flight -airline -airport`,
    `"${mpn}" "voltage regulator" OR IC OR semiconductor buy`,
  ];
  if (manufacturer) {
    base.unshift(`"${mpn}" "${manufacturer}" buy`);
    base.push(`"${mpn}" "${manufacturer}" distributor`);
  }
  base.push(`"${mpn}" supplier Europe -flight`);
  base.push(`"${mpn}" supplier Asia distributor`);
  return base;
}

function isLowValueDomain(domain: string, url: string): boolean {
  const blocked = [
    'youtube.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'linkedin.com',
    'wikipedia.org',
    'reddit.com',
    'pinterest.com',
    'flightaware.com',
    'flightstats.com',
    'skyscanner.com',
    'kayak.com',
    'expedia.com',
    'booking.com',
    'tripadvisor.com',
    'virginatlantic.com',
    'united.com',
  ];
  if (blocked.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  const lower = url.toLowerCase();
  if (lower.endsWith('.pdf')) return true;
  if (domain.includes('datasheet') && !lower.includes('buy') && !lower.includes('cart')) return true;
  if (/(^|\.)flight|airline|airport/.test(domain) && !lower.includes('electronic')) return true;
  return false;
}

export async function runExtractStage(jobId: string, env: PipelineEnv): Promise<void> {
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: {
      part: true,
      candidates: { where: { status: 'pending' }, orderBy: { score: 'desc' } },
    },
  });
  if (!job?.part || job.status === 'cancelled') return;

  await setJobStatus(jobId, 'extracting', {
    progressJson: { stage: 'extracting', percent: 55 },
  });
  await appendJobEvent(jobId, `Extracting and validating offers from ${job.candidates.length} candidates`, {
    stage: 'extracting',
  });

  const budget = budgetOf(job);
  const candidates = job.candidates.slice(0, budget.maxCandidates);

  for (const candidate of candidates) {
    const latest = await prisma.searchJob.findUnique({
      where: { id: jobId },
      select: { status: true, startedAt: true, budgetJson: true },
    });
    if (!latest || latest.status === 'cancelled') return;
    const wallClockMs = (latest.budgetJson as JobBudget).wallClockMs ?? budget.wallClockMs;
    if (latest.startedAt && Date.now() - latest.startedAt.getTime() > wallClockMs) {
      throw new AppError(ErrorCodes.BudgetExceeded, 'Job wall-clock budget exceeded');
    }

    await prisma.jobCandidate.update({
      where: { id: candidate.id },
      data: { status: 'extracting' },
    });

    try {
      const page = await safeFetchText(candidate.url, {
        timeoutMs: 12_000,
        maxBytes: 2_000_000,
        maxRedirects: 5,
      });
      if (page.status >= 400) {
        await prisma.jobCandidate.update({
          where: { id: candidate.id },
          data: {
            status: 'failed',
            rejectionReason: 'fetch_failed',
            errorMessage: `HTTP ${page.status}`,
          },
        });
        continue;
      }

      const artifact = await storeArtifact(env.artifactLocalPath, page.body);
      const draft = extractGenericOffer(page.body, job.part.originalMpn || job.part.rawMpn);
      const identity = extractProductIdentity(page.body, {
        pageUrl: page.finalUrl || candidate.url,
      });
      const candidateMpn = draft.mpn || identity.mpn || '';
      const exactStructured = candidateMpn
        ? mpnsMatch(candidateMpn, job.part.normalizedMpn)
        : false;
      const bodyHasExactToken =
        page.body.toUpperCase().includes(job.part.originalMpn.toUpperCase()) ||
        normalizeMpn(page.body).includes(job.part.normalizedMpn);
      const urlHasExactToken = normalizeMpn(page.finalUrl || candidate.url).includes(
        job.part.normalizedMpn,
      );
      const commerceSignals = lowerIncludesAny(page.body, [
        'add to cart',
        'add to basket',
        'buy now',
        'buy it now',
        'in stock',
        'quantity',
        'unit price',
        'price',
      ]);
      // Secondary accept: JS-heavy storefronts often lack JSON-LD but still sell the part.
      const exactCommerce =
        !exactStructured &&
        bodyHasExactToken &&
        urlHasExactToken &&
        commerceSignals &&
        !lowerIncludesAny(page.body, [
          'compatible with',
          'replacement for',
          'substitute for',
          'alternative to',
        ]) &&
        titlesCompatible(
          job.part.title,
          draft.description ?? identity.title,
          job.part.originalMpn,
        );
      const exact = exactStructured || exactCommerce;
      const matchConfidence = exactStructured ? 1 : exactCommerce ? 0.82 : 0;
      const offerManufacturer =
        draft.manufacturer ?? identity.manufacturer ?? identity.brand ?? null;

      if (!exact) {
        let reason = 'mpn_mismatch';
        if (
          lowerIncludesAny(page.body, [
            'compatible with',
            'replacement for',
            'substitute for',
            'alternative to',
          ])
        ) {
          reason = 'substitute';
        } else if (lowerIncludesAny(page.body, ['accessory', 'kit includes', 'evaluation board'])) {
          reason = 'accessory_or_kit';
        } else if (candidate.url.toLowerCase().endsWith('.pdf')) {
          reason = 'pdf_document';
        } else if (bodyHasExactToken) {
          reason = 'mention_only';
        } else if (!candidateMpn) {
          reason = 'mpn_not_found';
        }

        await prisma.jobCandidate.update({
          where: { id: candidate.id },
          data: {
            status: 'rejected',
            rejectionReason: reason,
            errorMessage: reason,
          },
        });
        continue;
      }

      // Extra guard: reject substitute/accessory language even when MPN string matches.
      if (
        lowerIncludesAny(page.body, [
          'compatible with',
          'replacement for',
          'substitute for',
          'alternative to',
          'replaces mpn',
        ]) &&
        !lowerIncludesAny(page.body, ['add to cart', 'buy now', 'add to basket'])
      ) {
        await prisma.jobCandidate.update({
          where: { id: candidate.id },
          data: {
            status: 'rejected',
            rejectionReason: 'substitute',
            errorMessage: 'substitute',
          },
        });
        continue;
      }

      if (
        !manufacturersCompatible(
          job.part.manufacturer ?? job.part.brand,
          offerManufacturer,
        )
      ) {
        await prisma.jobCandidate.update({
          where: { id: candidate.id },
          data: {
            status: 'rejected',
            rejectionReason: 'manufacturer_mismatch',
            errorMessage: 'manufacturer_mismatch',
          },
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
      const profile = await prisma.supplierProfile.findUnique({ where: { supplierId: supplier.id } });

      await prisma.offer.upsert({
        where: { jobId_productUrl: { jobId, productUrl: page.finalUrl || candidate.url } },
        create: {
          jobId,
          supplierId: supplier.id,
          mpn: candidateMpn || job.part.originalMpn,
          manufacturer: offerManufacturer,
          supplierPartNumber: identity.supplierSku ?? draft.mpn ?? null,
          productUrl: page.finalUrl || candidate.url,
          price: parsed ? new Prisma.Decimal(parsed.amount) : null,
          currency: parsed?.currency ?? draft.currency ?? null,
          stockQuantity: draft.stockQuantity ?? null,
          availability: draft.stockQuantity != null ? 'in_stock_or_listed' : null,
          leadTime: draft.leadTime ?? null,
          moq: draft.moq ?? null,
          sourceType: 'scrape',
          matchConfidence,
          possibleMatch: false,
          reliabilityScore: profile?.reliabilityScore ?? null,
          description: draft.description ?? identity.title,
          artifactHash: artifact.hash,
          artifactKey: artifact.key,
          extractedAt: new Date(),
        },
        update: {
          price: parsed ? new Prisma.Decimal(parsed.amount) : null,
          currency: parsed?.currency ?? draft.currency ?? null,
          stockQuantity: draft.stockQuantity ?? null,
          leadTime: draft.leadTime ?? null,
          matchConfidence,
          possibleMatch: false,
          reliabilityScore: profile?.reliabilityScore ?? null,
          description: draft.description ?? identity.title,
          artifactHash: artifact.hash,
          artifactKey: artifact.key,
          extractedAt: new Date(),
        },
      });

      await prisma.jobCandidate.update({
        where: { id: candidate.id },
        data: { status: 'extracted', rejectionReason: null },
      });
    } catch (error) {
      await prisma.jobCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'failed',
          rejectionReason: 'fetch_failed',
          errorMessage: error instanceof Error ? error.message : 'extract failed',
        },
      });
    }
  }

  await enqueue(env.redisUrl, 'jobs-normalize', 'normalize', { jobId }, `normalize-${jobId}`);
}

function lowerIncludesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

function manufacturersCompatible(
  expected?: string | null,
  actual?: string | null,
): boolean {
  if (!expected?.trim() || !actual?.trim()) return true;
  const left = expected.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const right = actual.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!left || !right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  // Common abbreviation pairs
  const aliases: Record<string, string[]> = {
    TI: ['TEXASINSTRUMENTS', 'TEXASINSTRUMENT'],
    TEXASINSTRUMENTS: ['TI', 'TEXASINSTRUMENT'],
    ST: ['STMICROELECTRONICS', 'STMICRO'],
    STMICROELECTRONICS: ['ST', 'STMICRO'],
  };
  const leftAliases = aliases[left] ?? [];
  const rightAliases = aliases[right] ?? [];
  if (leftAliases.includes(right) || rightAliases.includes(left)) return true;
  return false;
}

function brandHintFromUrl(rawUrl: string): string | undefined {
  try {
    const domain = extractRegistrableDomain(new URL(rawUrl).hostname);
    const label = domain.split('.')[0];
    if (!label || label.length < 3) return undefined;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return undefined;
  }
}

function titlesCompatible(
  sourceTitle?: string | null,
  pageTitle?: string | null,
  mpn?: string | null,
): boolean {
  if (mpn && pageTitle && normalizeMpn(pageTitle).includes(normalizeMpn(mpn))) {
    return true;
  }
  if (!sourceTitle?.trim() || !pageTitle?.trim()) return false;
  const tokenize = (value: string) =>
    new Set(
      value
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(
          (token) =>
            token.length > 2 &&
            !['THE', 'AND', 'FOR', 'WITH', 'FROM', 'PCB', 'IC'].includes(token),
        ),
    );
  const left = tokenize(sourceTitle);
  const right = tokenize(pageTitle);
  if (left.size === 0 || right.size === 0) return false;
  let hits = 0;
  for (const token of left) {
    if (right.has(token)) hits += 1;
  }
  return hits >= 1 && hits / Math.min(left.size, right.size) >= 0.2;
}

function guessCountry(domain: string): string | null {
  const tld = domain.split('.').pop()?.toLowerCase();
  const map: Record<string, string | null> = {
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
    com: null,
  };
  if (!tld) return null;
  return map[tld] ?? null;
}

export async function runNormalizeStage(jobId: string, env: PipelineEnv): Promise<void> {
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: {
      offers: { include: { supplier: true } },
      part: true,
    },
  });
  if (!job || job.status === 'cancelled') return;

  await setJobStatus(jobId, 'normalizing', {
    progressJson: { stage: 'normalizing', percent: 75 },
  });
  await appendJobEvent(jobId, 'Normalizing prices to USD, deduplicating, and ranking ~10 results', {
    stage: 'normalizing',
  });

  const currencies = job.offers.map((o) => o.currency).filter((c): c is string => Boolean(c));
  const rates = await fetchUsdRates(currencies);
  const asOf = new Date();

  for (const [currency, usdRate] of rates) {
    if (currency === 'USD') continue;
    await prisma.exchangeRate
      .create({
        data: {
          base: currency,
          quote: 'USD',
          rate: new Prisma.Decimal(usdRate),
          asOf,
          source: 'frankfurter',
        },
      })
      .catch(() => undefined);
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

  const refreshed = await prisma.offer.findMany({ where: { jobId } });
  const bySupplier = new Map<string, typeof refreshed>();
  for (const offer of refreshed) {
    const list = bySupplier.get(offer.supplierId) ?? [];
    list.push(offer);
    bySupplier.set(offer.supplierId, list);
  }

  for (const [, offers] of bySupplier) {
    const ranked = [...offers].sort((a, b) => {
      const sourceUrl = job.finalSourceUrl || job.rawSourceUrl || '';
      const aSource = sourceUrl && a.productUrl === sourceUrl ? 1 : 0;
      const bSource = sourceUrl && b.productUrl === sourceUrl ? 1 : 0;
      if (aSource !== bSource) return bSource - aSource;
      const aSuspicious = a.riskFlags.includes('ai_suspicious') ? 1 : 0;
      const bSuspicious = b.riskFlags.includes('ai_suspicious') ? 1 : 0;
      if (aSuspicious !== bSuspicious) return aSuspicious - bSuspicious;
      if (b.matchConfidence !== a.matchConfidence) return b.matchConfidence - a.matchConfidence;
      const aUsd = a.priceUsd == null ? Number.POSITIVE_INFINITY : Number(a.priceUsd);
      const bUsd = b.priceUsd == null ? Number.POSITIVE_INFINITY : Number(b.priceUsd);
      return aUsd - bUsd;
    });
    for (const extra of ranked.slice(1)) {
      await prisma.offer.delete({ where: { id: extra.id } });
    }
  }

  // Keep approximately N useful results: priced first, then unpriced; demote suspicious.
  const keep = await prisma.offer.findMany({
    where: { jobId, possibleMatch: false },
    orderBy: [{ priceUsd: { sort: 'asc', nulls: 'last' } }],
  });
  const trusted = keep.filter((o) => !o.riskFlags.includes('ai_suspicious'));
  const suspicious = keep.filter((o) => o.riskFlags.includes('ai_suspicious'));
  const ordered = [...trusted, ...suspicious];
  const winners = ordered.slice(0, env.resultLimit);
  const winnerIds = new Set(winners.map((o) => o.id));
  for (const offer of keep) {
    if (!winnerIds.has(offer.id)) {
      await prisma.offer.delete({ where: { id: offer.id } });
    }
  }

  const remaining = await prisma.offer.count({ where: { jobId } });
  await prisma.searchJob.update({
    where: { id: jobId },
    data: { offerCount: remaining },
  });

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

  await enqueue(env.redisUrl, 'jobs-enrich', 'enrich', { jobId }, `enrich-${jobId}`);
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
    await appendJobEvent(jobId, 'Running AI enrichment (summary / risk hints only)', {
      stage: 'enriching',
    });
    try {
      const result = await enrichSearchResults({
        apiKey: env.openaiApiKey,
        model: env.openaiModel,
        mpn: job.part?.originalMpn ?? job.part?.rawMpn ?? job.inputValue,
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
      await appendJobEvent(
        jobId,
        `AI enrichment skipped: ${error instanceof Error ? error.message : 'error'}`,
        { stage: 'enriching', level: 'warn' },
      );
    }
  } else {
    await appendJobEvent(jobId, 'AI disabled — skipping enrichment', { stage: 'enriching' });
  }

  // Re-read offers after optional AI risk flags so final counts/status are accurate.
  const finalOffers = await prisma.offer.findMany({
    where: { jobId },
    include: { supplier: true },
  });
  const failed = job.candidates.some((c) => c.status === 'failed');
  const status = finalOffers.length === 0 ? 'failed' : failed ? 'completed_with_errors' : 'completed';

  await setJobStatus(jobId, status, {
    finishedAt: new Date(),
    offerCount: finalOffers.length,
    summaryJson: {
      summary:
        summary ??
        `Identified ${job.part?.originalMpn ?? 'MPN'}; ${finalOffers.length} supplier options (best-effort worldwide discovery).`,
      offerCount: finalOffers.length,
      manufacturer: job.part?.manufacturer,
      mpn: job.part?.originalMpn,
      confidence: job.identificationConfidence,
    },
    progressJson: { stage: status, percent: 100 },
    ...(finalOffers.length === 0
      ? {
          errorCode: ErrorCodes.ExtractionError,
          errorMessage: 'No matching supplier offers found for the identified MPN',
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
