import { NextResponse } from 'next/server';
import { AppError, createSearchJob, createSearchSchema } from '@dex/core';
import { getServerEnv } from '@/lib/server-env';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'local';
    const limited = rateLimit(`search:${ip}`, { limit: 20, windowMs: 60_000 });
    if (!limited.allowed) {
      return NextResponse.json(
        { error: 'Too many searches. Please wait and try again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(limited.retryAfterSec) },
        },
      );
    }

    const json = await request.json();
    const parsed = createSearchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'A valid product-page URL is required' },
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

    const job = await createSearchJob(parsed.data, {
      redisUrl: env.REDIS_URL,
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create search';
    const status =
      error instanceof AppError &&
      (error.code === 'SSRF_BLOCKED' || error.code === 'VALIDATION_ERROR')
        ? 400
        : 500;
    // Do not leak internal stack traces to clients.
    const safeMessage =
      status === 500 && !(error instanceof AppError)
        ? 'Failed to create search'
        : message;
    return NextResponse.json({ error: safeMessage }, { status });
  }
}
