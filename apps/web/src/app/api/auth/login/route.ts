import { createHash, randomBytes, randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@dex/db';
import {
  authConfigured,
  authRequired,
  createSessionToken,
  isAllowedEmail,
  normalizeEmail,
  sessionSecret,
} from '@/lib/auth';
import { appBaseUrl, emailSendingConfigured, sendVerificationEmail } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
    if (!authRequired()) {
      return NextResponse.json({ ok: true, authRequired: false });
    }

    if (!authConfigured()) {
      return NextResponse.json(
        { error: 'Server misconfigured: set AUTH_SECRET for signed-in sessions' },
        { status: 503 },
      );
    }

    const limited = rateLimit(`login:${clientIp(request)}`, { limit: 15, windowMs: 60_000 });
    if (!limited.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Try again shortly.' },
        { status: 429 },
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
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    if (!isAllowedEmail(email)) {
      return NextResponse.json(
        {
          error: 'That email is not allowed. Use an @dex.com address or lmfelcher@gmail.com.',
        },
        { status: 401 },
      );
    }

    const secret = sessionSecret()!;

    // No email provider configured → instant sign-in for allowed emails.
    // (Set RESEND_API_KEY + EMAIL_FROM to enable real email verification.)
    if (!emailSendingConfigured()) {
      const session = await createSessionToken(secret, email);
      const response = NextResponse.json({
        ok: true,
        authRequired: true,
        signedIn: true,
        email,
      });
      response.cookies.set('dex_session', session, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
      return response;
    }

    // Email verification: 6-digit code + one-click magic link.
    const rawToken = randomBytes(32).toString('hex');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    try {
      await prisma.emailVerificationToken.deleteMany({ where: { email, usedAt: null } });
      await prisma.emailVerificationToken.create({
        data: {
          email,
          token: hashToken(rawToken),
          codeHash: hashToken(`${email}:${code}`),
          expiresAt,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          error:
            'Database error while creating the verification code. ' +
            'Confirm migrations ran and DATABASE_URL is set. ' +
            `(${message.slice(0, 180)})`,
        },
        { status: 503 },
      );
    }

    const verifyUrl = `${appBaseUrl(request)}/api/auth/verify?token=${rawToken}`;

    try {
      await sendVerificationEmail({ to: email, verifyUrl, code });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Failed to send verification email',
        },
        { status: 502 },
      );
    }

    const payload: Record<string, unknown> = {
      ok: true,
      authRequired: true,
      verificationSent: true,
      codeRequired: true,
      message: `We emailed a 6-digit code to ${email}.`,
    };

    // Local development convenience only; never returned in production.
    if (process.env.NODE_ENV !== 'production') {
      payload.devVerifyUrl = verifyUrl;
      payload.devCode = code;
    }

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected sign-in error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
