import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type SearchJob,
  type SearchJobStatus,
  prisma,
} from '@dex/db';
import { DEFAULT_JOB_BUDGET, type JobBudget } from '../budget.js';
import { AppError, ErrorCodes } from '../errors.js';
import { normalizeMpn } from '../mpn.js';
import { enqueue } from '../queue.js';
import { assertSafePublicUrl } from '../security/url.js';
import type { BatchItemInput, CreateSearchInput } from './schema.js';

export type CreateSearchContext = {
  redisUrl: string;
  orgId?: string;
};

export async function appendJobEvent(
  jobId: string,
  message: string,
  options?: { level?: string; stage?: string; data?: unknown },
): Promise<void> {
  await prisma.jobEvent.create({
    data: {
      jobId,
      message,
      level: options?.level ?? 'info',
      stage: options?.stage,
      dataJson: options?.data === undefined ? undefined : (options.data as Prisma.InputJsonValue),
    },
  });
}

export async function setJobStatus(
  jobId: string,
  status: SearchJobStatus,
  patch?: Prisma.SearchJobUpdateInput,
): Promise<void> {
  await prisma.searchJob.update({
    where: { id: jobId },
    data: {
      status,
      ...patch,
    },
  });
}

export async function createSearchJob(
  input: CreateSearchInput,
  ctx: CreateSearchContext,
): Promise<SearchJob> {
  await assertSafePublicUrl(input.url, { allowHttp: true });

  const traceId = randomUUID();
  const budget: JobBudget = { ...DEFAULT_JOB_BUDGET };

  const job = await prisma.searchJob.create({
    data: {
      orgId: ctx.orgId,
      inputType: 'URL',
      inputValue: input.url.trim(),
      rawSourceUrl: input.url.trim(),
      forceRefresh: input.forceRefresh ?? false,
      status: 'queued',
      resolveStatus: 'pending',
      traceId,
      budgetJson: budget,
      progressJson: { stage: 'queued', percent: 0 },
    },
  });

  await appendJobEvent(job.id, 'Search job created from product-page URL', {
    stage: 'queued',
    data: { forceRefresh: job.forceRefresh },
  });

  // BullMQ mode enqueues for the background worker; inline (serverless) mode
  // is a no-op — the dashboard's tick calls advance the pipeline instead.
  await enqueue(ctx.redisUrl, 'jobs-resolve', 'resolve', { jobId: job.id }, `resolve-${job.id}`);

  return job;
}

/**
 * MPN-direct search: the user already knows the part number (e.g. from the
 * DEX / SupplyItNow catalog), so identification is skipped and discovery
 * starts immediately.
 */
export async function createMpnSearchJob(
  item: BatchItemInput,
  ctx: CreateSearchContext & { batchId?: string; forceRefresh?: boolean },
): Promise<SearchJob> {
  const normalized = normalizeMpn(item.mpn);
  if (!normalized || normalized.length < 2) {
    throw new AppError(ErrorCodes.ValidationError, `Invalid part number: ${item.mpn}`);
  }

  const part = await prisma.part.create({
    data: {
      rawMpn: item.mpn.trim(),
      originalMpn: item.mpn.trim(),
      normalizedMpn: normalized,
      manufacturer: item.manufacturer?.trim() || null,
      brand: item.manufacturer?.trim() || null,
      title: item.description?.trim() || null,
      descriptionRaw: item.description?.trim() || null,
      descriptionClean: item.description?.trim() || null,
      identificationEvidence: {
        method: 'user_provided',
        confidence: 1,
        chosen: [
          {
            value: item.mpn.trim(),
            classification: 'mpn',
            source: 'user',
            path: 'batch.input',
            score: 1,
          },
        ],
      },
    },
  });

  const job = await prisma.searchJob.create({
    data: {
      orgId: ctx.orgId,
      batchId: ctx.batchId,
      inputType: 'MPN',
      inputValue: item.mpn.trim(),
      forceRefresh: ctx.forceRefresh ?? false,
      status: 'identifying_mpn',
      resolveStatus: 'identified',
      identificationConfidence: 1,
      identificationMethod: 'user_provided',
      partId: part.id,
      traceId: randomUUID(),
      budgetJson: { ...DEFAULT_JOB_BUDGET },
      progressJson: { stage: 'identifying_mpn', percent: 30 },
      // startedAt is set when discovery actually begins — in a large batch,
      // parts wait in line and must not burn wall-clock budget while queued.
    },
  });

  await appendJobEvent(
    job.id,
    `Part number provided directly: ${item.mpn.trim()}${item.description ? ` — ${item.description.trim().slice(0, 80)}` : ''}`,
    { stage: 'identifying_mpn' },
  );

  await enqueue(ctx.redisUrl, 'jobs-discover', 'discover', { jobId: job.id }, `discover-${job.id}`);

  return job;
}

/** Create a batch of MPN-direct searches grouped under one report id. */
export async function createBatchSearchJobs(
  items: BatchItemInput[],
  ctx: CreateSearchContext & { forceRefresh?: boolean },
): Promise<{ batchId: string; jobs: SearchJob[] }> {
  const batchId = randomUUID();
  const jobs: SearchJob[] = [];
  for (const item of items) {
    jobs.push(await createMpnSearchJob(item, { ...ctx, batchId }));
  }
  return { batchId, jobs };
}

export async function getBatchJobs(batchId: string) {
  return prisma.searchJob.findMany({
    where: { batchId },
    include: { part: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getSearchJob(jobId: string) {
  const job = await prisma.searchJob.findUnique({
    where: { id: jobId },
    include: {
      part: true,
      _count: { select: { offers: true, events: true, candidates: true } },
    },
  });
  if (!job) throw new AppError(ErrorCodes.NotFound, `Search job not found: ${jobId}`);
  return job;
}

export async function listJobEvents(jobId: string, after?: string) {
  return prisma.jobEvent.findMany({
    where: {
      jobId,
      ...(after ? { id: { gt: after } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
}

export async function listJobOffers(
  jobId: string,
  options?: {
    q?: string;
    sort?: 'priceUsd' | 'supplier' | 'country' | 'extractedAt';
    order?: 'asc' | 'desc';
    includePossible?: boolean;
    limit?: number;
  },
) {
  const order = options?.order ?? 'asc';
  const sort = options?.sort ?? 'priceUsd';
  const q = options?.q?.trim();
  const limit = options?.limit ?? 10;

  const offers = await prisma.offer.findMany({
    where: {
      jobId,
      possibleMatch: options?.includePossible ? undefined : false,
      ...(q
        ? {
            OR: [
              { mpn: { contains: q, mode: 'insensitive' } },
              { manufacturer: { contains: q, mode: 'insensitive' } },
              { productUrl: { contains: q, mode: 'insensitive' } },
              { supplierPartNumber: { contains: q, mode: 'insensitive' } },
              { supplier: { name: { contains: q, mode: 'insensitive' } } },
              { supplier: { domain: { contains: q, mode: 'insensitive' } } },
              { supplier: { country: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: { supplier: true },
    orderBy:
      sort === 'supplier'
        ? { supplier: { name: order } }
        : sort === 'country'
          ? { supplier: { country: order } }
          : sort === 'extractedAt'
            ? { extractedAt: order }
            : { priceUsd: { sort: order, nulls: 'last' } },
    take: Math.max(limit * 3, limit),
  });

  // Demote AI-flagged suspicious rows after primary sort; then apply limit.
  const ranked = [...offers].sort((a, b) => {
    const aSuspicious = a.riskFlags.includes('ai_suspicious') ? 1 : 0;
    const bSuspicious = b.riskFlags.includes('ai_suspicious') ? 1 : 0;
    if (aSuspicious !== bSuspicious) return aSuspicious - bSuspicious;
    return 0;
  });
  return ranked.slice(0, limit);
}

export async function cancelSearchJob(jobId: string) {
  const job = await getSearchJob(jobId);
  if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(job.status)) {
    return job;
  }
  await setJobStatus(jobId, 'cancelled', {
    finishedAt: new Date(),
    errorCode: ErrorCodes.Cancelled,
    errorMessage: 'Cancelled by user',
  });
  await appendJobEvent(jobId, 'Job cancelled', { stage: 'cancelled', level: 'warn' });
  return getSearchJob(jobId);
}
