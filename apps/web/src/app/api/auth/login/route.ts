import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@dex/db';
import {
  authConfigured,
  authRequired,
  isAllowedEmail,
  isDexEmail,
  normalizeEmail,
} from '@/lib/auth';
import { appBaseUrl, emailSendingConfigured, sendVerificationEmail } from '@/lib/email';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function POST(request: Request) {
  if (!authRequired()) {
    return NextResponse.json({ ok: true, authRequired: false });
  }

  if (!authConfigured()) {
    return NextResponse.json(
      { error: 'Server misconfigured: set AUTH_SECRET for signed-in sessions' },
      { status: 503 },
    );
  }

  let body: { email?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? '');
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid @dex.com work email' }, { status: 400 });
  }

  // Hard reject anything that is not @dex.com before sending mail.
  if (!isDexEmail(email)) {
    return NextResponse.json(
      { error: 'Only @dex.com email addresses can sign in. Gmail and other domains are blocked.' },
      { status: 401 },
    );
  }

  if (!isAllowedEmail(email)) {
    return NextResponse.json(
      { error: 'That @dex.com email is not authorized for this assistant' },
      { status: 401 },
    );
  }

  if (!emailSendingConfigured() && process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      {
        error:
          'Email verification is not configured. Set RESEND_API_KEY and EMAIL_FROM on the server.',
      },
      { status: 503 },
    );
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  // Invalidate older unused tokens for this email.
  await prisma.emailVerificationToken.deleteMany({
    where: { email, usedAt: null },
  });

  await prisma.emailVerificationToken.create({
    data: {
      email,
      token: tokenHash,
      expiresAt,
    },
  });

  const verifyUrl = `${appBaseUrl(request)}/api/auth/verify?token=${rawToken}`;

  if (emailSendingConfigured()) {
    try {
      await sendVerificationEmail({ to: email, verifyUrl });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : 'Failed to send verification email',
        },
        { status: 502 },
      );
    }
  }

  const payload: Record<string, unknown> = {
    ok: true,
    authRequired: true,
    verificationSent: emailSendingConfigured(),
    message: emailSendingConfigured()
      ? 'Check your @dex.com inbox for a verification link.'
      : 'Email provider not configured; use the local verification link.',
  };

  // Never expose magic links in production responses.
  if (process.env.NODE_ENV !== 'production' && !emailSendingConfigured()) {
    payload.devVerifyUrl = verifyUrl;
  }

  return NextResponse.json(payload);
}
