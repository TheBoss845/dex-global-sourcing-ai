import { NextResponse } from 'next/server';
import { AppError, createSearchJob, createSearchSchema } from '@dex/core';
import { getServerEnv } from '@/lib/server-env';

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = createSearchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'A valid product-page URL is required' },
        { status: 400 },
      );
    }

    const env = getServerEnv();
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
    return NextResponse.json({ error: message }, { status });
  }
}
