import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@dex/db';
import {
  createSessionToken,
  isAllowedEmail,
  normalizeEmail,
  sessionSecret,
} from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const MAX_ATTEMPTS = 6;

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(`verify-code:${clientIp(request)}`, {
      limit: 12,
      windowMs: 60_000,
    });
    if (!limited.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again shortly.' }, { status: 429 });
    }

    let body: { email?: string; code?: string } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const email = normalizeEmail(body.email ?? '');
    const code = (body.code ?? '').replace(/\D/g, '');
    if (!email.includes('@') || code.length !== 6) {
      return NextResponse.json({ error: 'Enter the 6-digit code from your email' }, { status: 400 });
    }

    if (!isAllowedEmail(email)) {
      return NextResponse.json({ error: 'That email is not allowed.' }, { status: 401 });
    }

    const secret = sessionSecret();
    if (!secret) {
      return NextResponse.json({ error: 'Server misconfigured: AUTH_SECRET missing' }, { status: 503 });
    }

    const record = await prisma.emailVerificationToken.findFirst({
      where: { email, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { error: 'Code expired or not found. Request a new one.' },
        { status: 401 },
      );
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      await prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      return NextResponse.json(
        { error: 'Too many wrong attempts. Request a new code.' },
        { status: 401 },
      );
    }

    if (!record.codeHash || record.codeHash !== hashToken(`${email}:${code}`)) {
      await prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return NextResponse.json({ error: 'Wrong code. Check your email and try again.' }, { status: 401 });
    }

    await prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    const session = await createSessionToken(secret, email);
    const response = NextResponse.json({ ok: true, signedIn: true, email });
    response.cookies.set('dex_session', session, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected verification error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
