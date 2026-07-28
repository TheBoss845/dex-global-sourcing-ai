import { NextResponse } from 'next/server';
import { AppError, createMpnSearchJob, createSearchJob } from '@dex/core';
import { getServerEnv } from '@/lib/server-env';
import { rateLimit } from '@/lib/rate-limit';

/** Does the input look like a web address rather than a part number/name? */
function looksLikeUrl(raw: string): boolean {
  if (/^https?:\/\//i.test(raw)) return true;
  return !raw.includes(' ') && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(raw);
}

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

    const json = (await request.json()) as {
      query?: string;
      url?: string;
      forceRefresh?: boolean;
    };
    const raw = (json.query ?? json.url ?? '').trim();
    if (raw.length < 2 || raw.length > 300) {
      return NextResponse.json(
        { error: 'Enter a product link, part number, or product name' },
        { status: 400 },
      );
    }
    const forceRefresh = Boolean(json.forceRefresh);

    const env = getServerEnv();
    if (!env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: 'Server is missing TAVILY_API_KEY; supplier discovery cannot run.' },
        { status: 503 },
      );
    }

    // Web address → read the page and identify the part.
    // Anything else → treat as a part number / product name and search directly.
    const job = looksLikeUrl(raw)
      ? await createSearchJob(
          { url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}`, forceRefresh },
          { redisUrl: env.REDIS_URL },
        )
      : await createMpnSearchJob(
          { mpn: raw },
          { redisUrl: env.REDIS_URL, forceRefresh },
        );

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
