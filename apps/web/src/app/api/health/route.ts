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
  const env = getServerEnv();
  const checks: Record<string, 'ok' | 'error'> = {
    api: 'ok',
    database: 'error',
    redis: 'error',
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  checks.redis = (await checkRedis(env.REDIS_URL)) ? 'ok' : 'error';

  const healthy = Object.values(checks).every((v) => v === 'ok');
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks,
      authRequired: process.env.NODE_ENV === 'production' || Boolean(process.env.AUTH_SECRET?.trim()),
    },
    { status: healthy ? 200 : 503 },
  );
}
