import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma, prisma } from '@dex/db';
import {
  KNOWN_DISTRIBUTORS,
  enrichSearchResults,
  identifyPartFromPage,
  isAiEnabled,
  sameManufacturer,
  verifyPartImage,
  verifyVendorOffer,
} from '@dex/ai';
import {
  TavilySearchProvider,
  extractContactEmail,
  extractGenericOffer,
  extractProductIdentity,
  extractProductImage,
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
  /**
   * Serverless platforms (Netlify) kill functions after ~10s, so every
   * stage invocation must stay well under that: chunked searches, parallel
   * candidate processing, and tighter network/AI timeouts.
   */
  serverless?: boolean;
};

function budgetOf(job: { budgetJson: unknown }): JobBudget {
  return job.budgetJson as JobBudget;
}

/**
 * Clean a page/product title into a usable product identifier.
 * Cuts marketing/site suffixes but keeps versions ("Raspberry Pi Zero - Version 1.3").
 */
function cleanProductName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let name = raw.trim();
  for (const sep of [' : ', ' | ', ' — ', ' – ', ' · ']) {
    const idx = name.indexOf(sep);
    if (idx > 5) name = name.slice(0, idx).trim();
  }
  if (name.length < 6 || name.length > 120) return null;
  if (!/[a-zA-Z]/.test(name)) return null;
  if (name.split(/\s+/).length < 2) return null;
  return name;
}

const NAME_STOPWORDS = new Set([
  'version',
  'ver',
  'the',
  'and',
  'for',
  'with',
  'new',
  'original',
  'official',
  'edition',
  'genuine',
]);

/** Every significant token of the product name must appear in the haystack. */
function nameTokensMatch(name: string, haystack: string): boolean {
  const hay = haystack.toLowerCase();
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length >= 2 || /\d/.test(t))
    .filter((t) => !NAME_STOPWORDS.has(t));
  if (!tokens.length) return false;
  return tokens.every((t) => hay.includes(t));
}

/** Strip markup and return readable page text (JSON-LD kept — it names products). */
function visibleTextExcerpt(html: string, maxChars = 9000): string {
  const jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]!.trim())
    .join('\n')
    .slice(0, 3000);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&quot;|&#39;|&lt;|&gt;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${jsonLd}\n${text}`.slice(0, maxChars);
}

async function storeArtifact(localPath: string, body: string): Promise<{ hash: string; key: string }> {
  const hash = createHash('sha256').update(body).digest('hex');
  const key = `${hash}.html`;
  // Serverless platforms (Netlify/Lambda) have read-only filesystems except
  // the OS temp dir — try the configured path first, then fall back.
  const candidates = [path.resolve(localPath), path.join(os.tmpdir(), 'dex-artifacts')];
  for (const dir of candidates) {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, key), body, 'utf8');
      return { hash, key };
    } catch {
      // try the next location
    }
  }
  // Artifacts are audit aids only — never fail a search over storage.
  return { hash, key: '' };
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
    timeoutMs: env.serverless ? 8_000 : 15_000,
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

  let identified = identifyManufacturerPartNumber({
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

  // AI fallback: pages without a labeled MPN (typical retail pages) get one
  // grounded identification attempt. The returned identifier must literally
  // appear on the page, or it is discarded.
  if ('failed' in identified && identified.failed && env.aiEnabled && env.openaiApiKey) {
    await appendJobEvent(jobId, 'No labeled MPN found — asking AI to identify the product (grounded)', {
      stage: 'identifying_mpn',
    });
    try {
      const aiIdentity = await identifyPartFromPage({
        apiKey: env.openaiApiKey,
        model: env.openaiModel,
        url: page.finalUrl || sourceUrl,
        title: identity.title,
        pageText: visibleTextExcerpt(page.body),
      });
      const candidate = aiIdentity?.partIdentifier?.trim();
      const grounded =
        candidate &&
        aiIdentity!.confidence >= 0.7 &&
        normalizeMpn(candidate).length >= 3 &&
        normalizeMpn(page.body).includes(normalizeMpn(candidate));
      if (grounded) {
        identified = identifyManufacturerPartNumber({
          mpn: candidate,
          manufacturer: aiIdentity!.manufacturer || identity.manufacturer,
          brand: identity.brand,
          supplierSku: identity.supplierSku,
          modelNumber: identity.modelNumber,
          title: identity.title || aiIdentity!.productName,
          description: identity.description,
          evidence: [
            ...identity.evidence,
            {
              value: candidate,
              classification: 'mpn',
              source: 'ai',
              path: 'ai.partIdentifier',
              score: Math.min(aiIdentity!.confidence, 0.86),
            },
          ],
          method: 'ai_identity',
        });
        if (!('failed' in identified)) {
          await appendJobEvent(
            jobId,
            `AI identified the product as ${candidate}${aiIdentity!.manufacturer ? ` (${aiIdentity!.manufacturer})` : ''} — verified against page text`,
            { stage: 'identifying_mpn' },
          );
        }
      }
    } catch (error) {
      await appendJobEvent(
        jobId,
        `AI identification unavailable (${error instanceof Error ? error.message.slice(0, 140) : 'error'}) — trying page title fallback`,
        { stage: 'identifying_mpn', level: 'warn' },
      );
    }
  }

  // Deterministic fallback: use the page's own product title (JSON-LD / OpenGraph)
  // as the search identifier. Never invented — it is literally the page's product name.
  if ('failed' in identified && identified.failed) {
    const structuredTitle =
      identity.evidence.find(
        (e) => e.classification === 'title' && (e.source === 'json_ld' || e.source === 'og'),
      )?.value ?? identity.title;
    const productName = cleanProductName(structuredTitle);
    if (productName) {
      identified = identifyManufacturerPartNumber({
        mpn: productName,
        manufacturer: identity.manufacturer,
        brand: identity.brand,
        supplierSku: identity.supplierSku,
        modelNumber: identity.modelNumber,
        title: identity.title,
        description: identity.description,
        evidence: [
          ...identity.evidence,
          {
            value: productName,
            classification: 'mpn',
            source: 'page_title',
            path: 'title.product_name',
            score: 0.74,
          },
        ],
        method: 'product_name',
      });
      if (!('failed' in identified)) {
        await appendJobEvent(
          jobId,
          `No manufacturer part number published — searching by exact product name "${productName}" instead`,
          { stage: 'identifying_mpn' },
        );
      }
    }
  }

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
      imageUrl: extractProductImage(page.body, page.finalUrl || sourceUrl) ?? null,
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

/**
 * Discovery is resumable: on serverless platforms each invocation runs at
 * most SERP_CHUNK search queries (in parallel) and persists progress, so a
 * single invocation always fits inside the platform's ~10s execution limit.
 * Returns 'more' while queries remain, 'done' when discovery is finalized.
 */
export async function runDiscoverStage(
  jobId: string,
  env: PipelineEnv,
): Promise<'more' | 'done'> {
  const SERP_CHUNK = 2;
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: { part: true },
  });
  if (!job?.part || job.status === 'cancelled') return 'done';

  const progress = (job.progressJson ?? {}) as Record<string, unknown>;
  const serpDone = Number(progress.serpDone ?? 0);
  const relaxedDone = Boolean(progress.relaxedDone);

  if (job.status !== 'discovering') {
    await setJobStatus(jobId, 'discovering', {
      progressJson: { ...progress, stage: 'discovering', percent: 40 },
      // MPN-direct (batch) jobs start their wall clock here, when work begins.
      startedAt: job.startedAt ?? new Date(),
    });
    await appendJobEvent(jobId, 'Searching worldwide for exact MPN suppliers (best-effort)', {
      stage: 'discovering',
    });
  }

  const budget = budgetOf(job);
  const suggestions = await suggestSuppliers({
    normalizedMpn: job.part.normalizedMpn,
    manufacturer: job.part.manufacturer ?? undefined,
    orgId: job.orgId ?? undefined,
    limit: 10,
  });

  if (suggestions.length && serpDone === 0) {
    await appendJobEvent(jobId, `Knowledge assist suggested ${suggestions.length} suppliers`, {
      stage: 'discovering',
      data: { domains: suggestions.map((s) => s.supplierDomain) },
    });
  }

  const provider = new TavilySearchProvider(env.tavilyApiKey);
  // Search with the human-readable part text (RC0805FR-0710KL, not RC0805FR0710KL):
  // suppliers list parts the way manufacturers write them.
  const searchTerm = job.part.originalMpn || job.part.rawMpn || job.part.normalizedMpn;
  const primaryQueries = buildSearchQueries(searchTerm, job.part.manufacturer).slice(
    0,
    budget.maxSerpQueries,
  );

  const chunk = env.serverless
    ? primaryQueries.slice(serpDone, serpDone + SERP_CHUNK)
    : primaryQueries.slice(serpDone);

  const hits: Awaited<ReturnType<typeof provider.search>> = [];
  if (chunk.length > 0) {
    const settled = await Promise.allSettled(
      chunk.map((query) => provider.search(query, { maxResults: 8 })),
    );
    for (const result of settled) {
      if (result.status === 'fulfilled') hits.push(...result.value);
    }
    if (settled.every((r) => r.status === 'rejected')) {
      await appendJobEvent(jobId, 'Search queries failed this round — will keep going', {
        stage: 'discovering',
        level: 'warn',
      });
    }
  }
  const newSerpDone = serpDone + chunk.length;
  const primaryFinished = newSerpDone >= primaryQueries.length;

  // Second wave: obscure parts often miss on strict quoted queries. When the
  // primary pass finished thin, broaden with unquoted/description searches.
  let markRelaxedDone = relaxedDone;
  if (primaryFinished && !relaxedDone) {
    const existingCandidates = await prisma.jobCandidate.count({ where: { jobId } });
    if (existingCandidates + hits.length < 8) {
      const relaxed: string[] = [];
      const manufacturer = job.part.manufacturer?.trim();
      relaxed.push(`${searchTerm} ${manufacturer ?? ''} buy price`.trim());
      const keywords = descriptionKeywords(job.part.title ?? job.part.descriptionClean);
      if (keywords) {
        relaxed.push(`${manufacturer ?? ''} ${searchTerm} ${keywords} supplier`.trim());
      }
      await appendJobEvent(
        jobId,
        'Few strict matches — expanding with broader searches (manufacturer + description keywords)',
        { stage: 'discovering' },
      );
      const settled = await Promise.allSettled(
        relaxed.slice(0, 2).map((query) => provider.search(query, { maxResults: 8 })),
      );
      for (const result of settled) {
        if (result.status === 'fulfilled') hits.push(...result.value);
      }
    }
    markRelaxedDone = true;
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

  // More primary queries remain (serverless chunking): persist progress and
  // let the next invocation continue exactly where this one stopped.
  if (!primaryFinished) {
    await prisma.searchJob.update({
      where: { id: jobId },
      data: {
        progressJson: {
          ...progress,
          stage: 'discovering',
          percent: 40 + Math.round((newSerpDone / Math.max(1, primaryQueries.length)) * 10),
          serpDone: newSerpDone,
        } as Prisma.InputJsonValue,
      },
    });
    return 'more';
  }

  const totalCandidates = await prisma.jobCandidate.count({ where: { jobId } });
  await appendJobEvent(jobId, `Queued ${totalCandidates} candidates for extraction`, {
    stage: 'discovering',
  });
  await prisma.searchJob.update({
    where: { id: jobId },
    data: {
      progressJson: {
        ...progress,
        stage: 'discovering',
        percent: 50,
        serpDone: newSerpDone,
        relaxedDone: markRelaxedDone,
        discoverDone: true,
      } as Prisma.InputJsonValue,
    },
  });

  // Always include the original source product page as a candidate so the user
  // sees at least the supplier they started from when it validates —
  // unless the source is a DEX property (DEX never buys from itself).
  if (job.finalSourceUrl || job.rawSourceUrl) {
    const source = job.finalSourceUrl || job.rawSourceUrl!;
    try {
      const hostname = new URL(source).hostname;
      const domain = extractRegistrableDomain(hostname);
      if (isOwnCompanyDomain(domain)) {
        await appendJobEvent(jobId, 'Source page is a DEX property — excluded from vendor results', {
          stage: 'discovering',
        });
        await enqueue(env.redisUrl, 'jobs-extract', 'extract', { jobId }, `extract-${jobId}`);
        return 'done';
      }
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
  return 'done';
}

const DESCRIPTION_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'type', 'series', 'model', 'part', 'new', 'used',
]);

/** First few significant words of a part description, for broadened searches. */
function descriptionKeywords(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !DESCRIPTION_STOPWORDS.has(token))
    .slice(0, 4)
    .join(' ');
}

function buildSearchQueries(mpn: string, manufacturer?: string | null): string[] {
  const base = [
    `"${mpn}" buy`,
    `"${mpn}" distributor`,
    `"${mpn}" price in stock -flight -airline -airport`,
    `"${mpn}" order online supplier`,
  ];
  if (manufacturer) {
    base.unshift(`"${mpn}" "${manufacturer}" buy`);
    base.push(`"${mpn}" "${manufacturer}" distributor`);
  }
  base.push(`"${mpn}" supplier Europe -flight`);
  base.push(`"${mpn}" supplier Asia distributor`);
  return base;
}

/**
 * DEX's own properties — this tool finds external suppliers for DEX,
 * so DEX must never appear as a vendor in its own reports.
 * Extend without code changes via EXCLUDED_VENDOR_DOMAINS (comma list).
 */
const OWN_COMPANY_DOMAINS = [
  'supplyitnow.com',
  'dex.com',
  'dataexchange.com',
  'dataexchangecorp.com',
];

function isOwnCompanyDomain(domain: string): boolean {
  const extra = (process.env.EXCLUDED_VENDOR_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return [...OWN_COMPANY_DOMAINS, ...extra].some(
    (own) => domain === own || domain.endsWith(`.${own}`),
  );
}

function isLowValueDomain(domain: string, url: string): boolean {
  if (isOwnCompanyDomain(domain)) return true;
  const blocked = [
    'youtube.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'linkedin.com',
    'wikipedia.org',
    'reddit.com',
    'pinterest.com',
    'stackexchange.com',
    'stackoverflow.com',
    'quora.com',
    'github.com',
    'medium.com',
    'instructables.com',
    'hackaday.com',
    'blogspot.com',
    'wordpress.com',
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

  // Marketplace search/category pages are not vendor offers — only accept
  // actual product listings from the big marketplaces.
  if (domain.endsWith('amazon.com') && !lower.includes('/dp/') && !lower.includes('/gp/product')) {
    return true;
  }
  if (domain.endsWith('ebay.com') && !lower.includes('/itm/')) return true;
  if (
    (domain.endsWith('alibaba.com') || domain.endsWith('aliexpress.com')) &&
    !lower.includes('product-detail') &&
    !lower.includes('/item/')
  ) {
    return true;
  }
  return false;
}

export async function runExtractStage(
  jobId: string,
  env: PipelineEnv,
  options?: { candidateLimit?: number; fetchTimeoutMs?: number },
): Promise<void> {
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: {
      part: true,
      candidates: { where: { status: 'pending' }, orderBy: { score: 'desc' } },
    },
  });
  if (!job?.part || job.status === 'cancelled') return;
  const part = job.part;

  await setJobStatus(jobId, 'extracting', {
    progressJson: { stage: 'extracting', percent: 55 },
  });
  if (!options?.candidateLimit || job.candidates.length <= options.candidateLimit) {
    await appendJobEvent(jobId, `Extracting and validating offers from ${job.candidates.length} candidates`, {
      stage: 'extracting',
    });
  }

  const budget = budgetOf(job);
  const candidates = job.candidates.slice(
    0,
    Math.min(options?.candidateLimit ?? budget.maxCandidates, budget.maxCandidates),
  );
  const fetchTimeoutMs = options?.fetchTimeoutMs ?? 12_000;

  // Pre-checks run sequentially (cheap DB work), then the network-heavy
  // candidate processing runs in parallel on serverless so a 2-candidate
  // batch fits inside the platform's ~10s execution limit.
  const ready: typeof candidates = [];
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

    // DEX never buys from itself — reject own-company candidates outright.
    if (isOwnCompanyDomain(candidate.domain)) {
      await prisma.jobCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'rejected',
          rejectionReason: 'own_company',
          errorMessage: 'DEX property — excluded from vendor results',
        },
      });
      continue;
    }

    await prisma.jobCandidate.update({
      where: { id: candidate.id },
      data: { status: 'extracting' },
    });
    ready.push(candidate);
  }

  const processCandidate = async (candidate: (typeof candidates)[number]): Promise<void> => {
    try {
      const page = await safeFetchText(candidate.url, {
        timeoutMs: fetchTimeoutMs,
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
        return;
      }

      const artifact = await storeArtifact(env.artifactLocalPath, page.body);
      const draft = extractGenericOffer(page.body, part.originalMpn || part.rawMpn);
      const identity = extractProductIdentity(page.body, {
        pageUrl: page.finalUrl || candidate.url,
      });
      const candidateMpn = draft.mpn || identity.mpn || '';
      const exactStructured = candidateMpn
        ? mpnsMatch(candidateMpn, part.normalizedMpn)
        : false;
      const bodyHasExactToken =
        page.body.toUpperCase().includes(part.originalMpn.toUpperCase()) ||
        normalizeMpn(page.body).includes(part.normalizedMpn);
      const urlHasExactToken = normalizeMpn(page.finalUrl || candidate.url).includes(
        part.normalizedMpn,
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
          part.title,
          draft.description ?? identity.title,
          part.originalMpn,
        );
      // Name-identifier accept: when the part was identified by product name
      // (no published MPN), require every significant name token plus commerce signals.
      const identifierIsName = /\s/.test((part.originalMpn || '').trim());
      const exactName =
        !exactStructured &&
        !exactCommerce &&
        identifierIsName &&
        commerceSignals &&
        nameTokensMatch(part.originalMpn, page.body) &&
        !lowerIncludesAny(page.body, [
          'compatible with',
          'replacement for',
          'substitute for',
          'alternative to',
        ]);
      const exact = exactStructured || exactCommerce || exactName;
      let matchConfidence = exactStructured ? 1 : exactCommerce ? 0.82 : exactName ? 0.75 : 0;

      // AI second opinion on borderline (non-structured) matches: is this page
      // really selling the exact part? Fail-open — deterministic gates already
      // passed, so an AI outage never blocks results.
      if (exact && !exactStructured && env.aiEnabled && env.openaiApiKey) {
        try {
          const verdict = await verifyVendorOffer({
            apiKey: env.openaiApiKey,
            model: env.openaiModel,
            mpn: part.originalMpn,
            manufacturer: part.manufacturer ?? part.brand,
            partDescription: part.title ?? part.descriptionClean,
            pageUrl: page.finalUrl || candidate.url,
            pageExcerpt: visibleTextExcerpt(page.body, 6000),
            timeoutMs: env.serverless ? 5_000 : 15_000,
          });
          if (verdict) {
            if (!verdict.sellsExactPart && verdict.confidence >= 0.6) {
              await prisma.jobCandidate.update({
                where: { id: candidate.id },
                data: {
                  status: 'rejected',
                  rejectionReason: 'ai_rejected',
                  errorMessage: (verdict.reason ?? 'AI verification: not the exact part').slice(0, 200),
                },
              });
              return;
            }
            if (verdict.sellsExactPart) {
              matchConfidence = Math.min(0.95, Math.max(matchConfidence, verdict.confidence));
            }
          }
        } catch {
          // fail open — keep the deterministic decision
        }
      }
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
        return;
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
        return;
      }

      if (
        !manufacturersCompatible(
          part.manufacturer ?? part.brand,
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
        return;
      }

      const known = KNOWN_DISTRIBUTORS[candidate.domain];
      const contactEmail = extractContactEmail(page.body);
      const supplier = await prisma.supplier.upsert({
        where: { domain: candidate.domain },
        create: {
          domain: candidate.domain,
          name: draft.supplierName ?? known?.name ?? candidate.domain,
          website: `https://${candidate.domain}`,
          country: draft.country ?? known?.country ?? guessCountry(candidate.domain),
          contactEmail: contactEmail ?? null,
        },
        update: {
          name: draft.supplierName ?? known?.name ?? undefined,
          country: draft.country ?? known?.country ?? undefined,
          ...(contactEmail ? { contactEmail } : {}),
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
          mpn: candidateMpn || part.originalMpn,
          manufacturer: offerManufacturer,
          supplierPartNumber: identity.supplierSku ?? draft.mpn ?? null,
          productUrl: page.finalUrl || candidate.url,
          price: parsed ? new Prisma.Decimal(parsed.amount) : null,
          currency: parsed?.currency ?? draft.currency ?? null,
          stockQuantity: draft.stockQuantity ?? null,
          availability:
            draft.availability ?? (draft.stockQuantity != null ? 'In stock' : null),
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

      // Batch (MPN-direct) parts have no source page — adopt the product photo
      // from the first verified vendor listing.
      if (!part.imageUrl) {
        const vendorImage = extractProductImage(page.body, page.finalUrl || candidate.url);
        if (vendorImage) {
          await prisma.part.update({
            where: { id: part.id },
            data: { imageUrl: vendorImage },
          });
          part.imageUrl = vendorImage;
        }
      }
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
  };

  if (env.serverless) {
    // Parallel: a 2-candidate batch completes in one platform time slot.
    await Promise.all(ready.map((candidate) => processCandidate(candidate)));
  } else {
    for (const candidate of ready) {
      await processCandidate(candidate);
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
  // Full alias knowledge base: TI/Texas Instruments, HP/Compaq/HPE,
  // ABB/Baldor, TE/Tyco/AMP/Crompton, Dell/EMC, and ~70 more identities.
  return sameManufacturer(expected, actual);
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
    es: 'ES',
    pt: 'PT',
    nl: 'NL',
    be: 'BE',
    at: 'AT',
    ch: 'CH',
    se: 'SE',
    no: 'NO',
    dk: 'DK',
    fi: 'FI',
    pl: 'PL',
    cz: 'CZ',
    hu: 'HU',
    ro: 'RO',
    gr: 'GR',
    ie: 'IE',
    il: 'IL',
    tr: 'TR',
    ae: 'AE',
    sa: 'SA',
    za: 'ZA',
    in: 'IN',
    th: 'TH',
    my: 'MY',
    id: 'ID',
    ph: 'PH',
    vn: 'VN',
    hk: 'HK',
    au: 'AU',
    nz: 'NZ',
    br: 'BR',
    ar: 'AR',
    cl: 'CL',
    ca: 'CA',
    mx: 'MX',
    sg: 'SG',
    ru: 'RU',
    ua: 'UA',
    us: 'US',
    eu: 'EU',
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

  // Deterministic sanity check: flag prices wildly off from the group median
  // so a $2 "bargain" for a $200 part is visibly suspicious, not silently ranked first.
  const pricedOffers = (await prisma.offer.findMany({ where: { jobId } })).filter(
    (o) => o.priceUsd != null && Number(o.priceUsd) > 0,
  );
  if (pricedOffers.length >= 3) {
    const sortedUsd = pricedOffers.map((o) => Number(o.priceUsd)).sort((a, b) => a - b);
    const median = sortedUsd[Math.floor(sortedUsd.length / 2)]!;
    for (const offer of pricedOffers) {
      const usd = Number(offer.priceUsd);
      if (usd < median * 0.15 || usd > median * 6) {
        const flags = Array.from(new Set([...(offer.riskFlags ?? []), 'price_outlier']));
        await prisma.offer.update({ where: { id: offer.id }, data: { riskFlags: flags } });
      }
    }
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
        partDescription: job.part?.descriptionRaw ?? job.part?.descriptionClean,
        partTitle: job.part?.title,
        offers: job.offers.map((o, index) => ({
          index,
          supplier: o.supplier.name ?? o.supplier.domain,
          country: o.supplier.country,
          priceUsd: o.priceUsd == null ? null : Number(o.priceUsd),
          description: o.description,
          productUrl: o.productUrl,
        })),
        timeoutMs: env.serverless ? 7_000 : 20_000,
      });
      summary = result.summary;
      if (job.part && (result.cleanedDescription || result.productName)) {
        await prisma.part.update({
          where: { id: job.part.id },
          data: {
            ...(result.cleanedDescription ? { descriptionClean: result.cleanedDescription } : {}),
            ...(result.productName ? { displayName: result.productName } : {}),
          },
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

      // Vision check: confirm the product photo actually shows this part.
      // Fail open — a photo is only removed when the AI is confident it's wrong.
      if (job.part?.imageUrl) {
        try {
          const verdict = await verifyPartImage({
            apiKey: env.openaiApiKey,
            model: env.openaiModel,
            mpn: job.part.originalMpn,
            manufacturer: job.part.manufacturer,
            description: result.cleanedDescription ?? job.part.title,
            imageUrl: job.part.imageUrl,
            timeoutMs: env.serverless ? 6_000 : 20_000,
          });
          if (verdict && !verdict.matches && verdict.confidence >= 0.6) {
            await prisma.part.update({
              where: { id: job.part.id },
              data: { imageUrl: null },
            });
            await appendJobEvent(
              jobId,
              `Photo removed — AI judged it shows ${verdict.whatItShows ?? 'a different product'}, not this part`,
              { stage: 'enriching', level: 'warn' },
            );
          } else if (verdict?.matches) {
            await appendJobEvent(jobId, 'AI confirmed the product photo matches this part', {
              stage: 'enriching',
            });
          }
        } catch {
          // keep the photo when vision is unavailable
        }
      }
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

const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled']);

/** How many candidates one tick may extract (keeps serverless invocations short). */
const TICK_CANDIDATE_BATCH = 2;
const TICK_FETCH_TIMEOUT_MS = 6_000;

/**
 * Advance a job by one small step. Used in serverless (inline) deployments
 * where no background worker exists: the dashboard polls this while a job
 * runs, and each call performs a bounded amount of work.
 */
export async function runPipelineTick(
  jobId: string,
  env: PipelineEnv,
): Promise<{ state: 'running' | 'done'; stage: string }> {
  const job = await prisma.searchJob.findUnique({ where: { id: jobId } });
  if (!job) return { state: 'done', stage: 'missing' };
  if (TERMINAL_STATUSES.has(job.status)) return { state: 'done', stage: job.status };

  // Recover candidates stranded mid-extraction by a previously interrupted invocation.
  await prisma.jobCandidate.updateMany({
    where: {
      jobId,
      status: 'extracting',
      updatedAt: { lt: new Date(Date.now() - 90_000) },
    },
    data: { status: 'pending' },
  });

  try {
    if (
      ['queued', 'validating', 'fetching_source', 'extracting_identity'].includes(job.status) ||
      (job.status === 'identifying_mpn' && job.resolveStatus !== 'identified')
    ) {
      await runResolveStage(jobId, env);
      return { state: 'running', stage: 'resolve' };
    }

    if (job.status === 'identifying_mpn') {
      await runDiscoverStage(jobId, env);
      return { state: 'running', stage: 'discover' };
    }

    const progress = (job.progressJson ?? {}) as Record<string, unknown>;

    // Discovery runs in bounded chunks; keep invoking until it reports done.
    if (job.status === 'discovering' && !progress.discoverDone) {
      const state = await runDiscoverStage(jobId, env);
      return { state: 'running', stage: state === 'more' ? 'discover' : 'extract' };
    }

    const pending = await prisma.jobCandidate.count({
      where: { jobId, status: { in: ['pending', 'extracting'] } },
    });

    if ((job.status === 'discovering' || job.status === 'extracting') && pending > 0) {
      await runExtractStage(jobId, env, {
        candidateLimit: TICK_CANDIDATE_BATCH,
        fetchTimeoutMs: TICK_FETCH_TIMEOUT_MS,
      });
      const stillPending = await prisma.jobCandidate.count({
        where: { jobId, status: 'pending' },
      });
      if (stillPending > 0) return { state: 'running', stage: 'extract' };
      // Candidates finished: normalize on the next tick.
      await runNormalizeStage(jobId, env);
      return { state: 'running', stage: 'normalize' };
    }

    if (job.status === 'discovering' || job.status === 'extracting') {
      // No candidates at all — normalize/finish honestly.
      await runNormalizeStage(jobId, env);
      return { state: 'running', stage: 'normalize' };
    }

    // status 'normalizing' (or an interrupted 'enriching'): final ranking + audit.
    await runEnrichStage(jobId, env);
    await runKnowledgeStage(jobId);
    const finished = await prisma.searchJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return { state: 'done', stage: finished?.status ?? 'completed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pipeline step failed';
    const code = error instanceof AppError ? error.code : 'PIPELINE_ERROR';

    // Transient problems (network hiccups, search-provider 429s) retry on the
    // next tick instead of failing the part. Permanent problems fail fast.
    const permanent =
      code === ErrorCodes.BudgetExceeded ||
      code === ErrorCodes.ValidationError ||
      code === ErrorCodes.SsrfBlocked ||
      code === ErrorCodes.BannedDomain ||
      code === ErrorCodes.NotFound;
    const progress = (job.progressJson ?? {}) as Record<string, unknown>;
    const tickErrors = Number(progress.tickErrors ?? 0);

    if (!permanent && tickErrors < 2) {
      await prisma.searchJob.update({
        where: { id: jobId },
        data: {
          progressJson: { ...progress, tickErrors: tickErrors + 1 } as Prisma.InputJsonValue,
        },
      });
      await appendJobEvent(
        jobId,
        `Temporary problem (${message.slice(0, 120)}) — retrying (attempt ${tickErrors + 2} of 3)`,
        { stage: 'retrying', level: 'warn' },
      );
      return { state: 'running', stage: 'retrying' };
    }

    await setJobStatus(jobId, 'failed', {
      finishedAt: new Date(),
      errorCode: code,
      errorMessage: message,
      progressJson: { stage: 'failed', percent: 100 },
    });
    await appendJobEvent(jobId, message, { stage: 'failed', level: 'error' });
    return { state: 'done', stage: 'failed' };
  }
}
