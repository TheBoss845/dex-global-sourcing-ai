import { NextResponse } from 'next/server';
import { AppError, createBatchSchema, createBatchSearchJobs } from '@dex/core';
import { getServerEnv } from '@/lib/server-env';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'local';
    const limited = rateLimit(`batch:${ip}`, { limit: 5, windowMs: 60_000 });
    if (!limited.allowed) {
      return NextResponse.json(
        { error: 'Too many batch reports. Please wait and try again.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }

    const json = await request.json();
    const parsed = createBatchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'A list of part numbers is required' },
        { status: 400 },
      );
    }

    const env = getServerEnv();
    if (!env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: 'Server is missing TAVILY_API_KEY; supplier discovery cannot run.' },
        { status: 503 },
      );
    }

    const { batchId, jobs } = await createBatchSearchJobs(parsed.data.items, {
      redisUrl: env.REDIS_URL,
      forceRefresh: parsed.data.forceRefresh,
    });

    return NextResponse.json(
      {
        batchId,
        jobs: jobs.map((job) => ({ id: job.id, mpn: job.inputValue, status: job.status })),
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create batch report';
    const status = error instanceof AppError && error.code === 'VALIDATION_ERROR' ? 400 : 500;
    return NextResponse.json(
      { error: status === 500 && !(error instanceof AppError) ? 'Failed to create batch report' : message },
      { status },
    );
  }
}
