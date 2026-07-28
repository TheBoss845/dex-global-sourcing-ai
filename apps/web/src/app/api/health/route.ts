import net from 'node:net';
import { NextResponse } from 'next/server';
import { prisma } from '@dex/db';
import { getServerEnv } from '@/lib/server-env';

async function checkRedis(redisUrl: string): Promise<boolean> {
  const url = new URL(redisUrl);
  const host = url.hostname;
  const port = Number(url.port || 6379);
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function GET() {
  // Never crash the health endpoint: report missing configuration instead.
  const databaseUrlSet = Boolean(
    process.env.DATABASE_URL?.trim() || process.env.NETLIFY_DATABASE_URL?.trim(),
  );
  const missing: string[] = [];
  if (!databaseUrlSet) missing.push('DATABASE_URL');
  if (!process.env.AUTH_SECRET?.trim()) missing.push('AUTH_SECRET (recommended)');
  if (!process.env.TAVILY_API_KEY?.trim()) missing.push('TAVILY_API_KEY');

  if (!databaseUrlSet) {
    return NextResponse.json(
      {
        status: 'misconfigured',
        error:
          'DATABASE_URL is not visible to the running server. In Netlify: Site configuration → Environment variables → make sure DATABASE_URL exists with scope "All scopes" (not Builds-only), then Deploys → Clear cache and deploy site.',
        missing,
      },
      { status: 503 },
    );
  }

  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch (error) {
    return NextResponse.json(
      {
        status: 'misconfigured',
        error: error instanceof Error ? error.message : 'Invalid server configuration',
        missing,
      },
      { status: 503 },
    );
  }

  const checks: Record<string, 'ok' | 'error' | 'skipped'> = {
    api: 'ok',
    database: 'error',
    redis: 'skipped',
  };
  let databaseError: string | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (error) {
    checks.database = 'error';
    databaseError = error instanceof Error ? error.message.slice(0, 300) : 'connection failed';
  }

  // Serverless (inline queue) deployments run without Redis.
  if (env.REDIS_URL?.trim()) {
    checks.redis = (await checkRedis(env.REDIS_URL)) ? 'ok' : 'error';
  }

  const healthy = Object.values(checks).every((v) => v === 'ok' || v === 'skipped');
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks,
      ...(databaseError ? { databaseError } : {}),
      ...(missing.length ? { missing } : {}),
      queueDriver: process.env.REDIS_URL?.trim() ? 'bullmq' : 'inline',
      ai: {
        enabled: env.AI_ENABLED,
        openaiKeySet: Boolean(env.OPENAI_API_KEY?.trim()),
      },
      tavilyKeySet: Boolean(env.TAVILY_API_KEY?.trim()),
      authRequired: process.env.NODE_ENV === 'production' || Boolean(process.env.AUTH_SECRET?.trim()),
      email: {
        resendKeySet: Boolean(
          process.env.RESEND_API_KEY?.trim() || process.env.RESEND_API?.trim(),
        ),
        emailFromSet: Boolean(process.env.EMAIL_FROM?.trim()),
        emailFrom: process.env.EMAIL_FROM?.trim()
          ? process.env.EMAIL_FROM.trim().replace(/[^@\s<>a-zA-Z0-9._+-]/g, '*').slice(0, 80)
          : null,
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
