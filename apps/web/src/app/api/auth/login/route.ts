import { createHash, randomBytes } from 'node:crypto';
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

/** Email-link verification is opt-in; default is instant sign-in for allowed emails. */
function emailVerificationRequired(): boolean {
  return process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'true';
}

function sessionCookieResponse(
  body: Record<string, unknown>,
  session: string,
): NextResponse {
  const response = NextResponse.json(body);
  response.cookies.set('dex_session', session, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
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

    // Default: allowed email signs in immediately. No email delivery involved.
    if (!emailVerificationRequired()) {
      const session = await createSessionToken(secret, email);
      return sessionCookieResponse(
        { ok: true, authRequired: true, signedIn: true, email },
        session,
      );
    }

    // Strict mode (AUTH_REQUIRE_EMAIL_VERIFICATION=true): email a magic link.
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    try {
      await prisma.emailVerificationToken.deleteMany({ where: { email, usedAt: null } });
      await prisma.emailVerificationToken.create({
        data: { email, token: hashToken(rawToken), expiresAt },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          error:
            'Database error while creating the verification token. ' +
            'Confirm migrations ran and DATABASE_URL is set. ' +
            `(${message.slice(0, 180)})`,
        },
        { status: 503 },
      );
    }

    const verifyUrl = `${appBaseUrl(request)}/api/auth/verify?token=${rawToken}`;
    let emailError: string | null = null;
    let emailSent = false;

    if (emailSendingConfigured()) {
      try {
        await sendVerificationEmail({ to: email, verifyUrl });
        emailSent = true;
      } catch (error) {
        emailError = error instanceof Error ? error.message : 'Failed to send verification email';
      }
    }

    const showLink = process.env.NODE_ENV !== 'production' || !emailSent;

    return NextResponse.json({
      ok: true,
      authRequired: true,
      verificationSent: emailSent,
      verifyUrl: showLink ? verifyUrl : undefined,
      message: emailSent
        ? 'Check your inbox for a verification link.'
        : emailError
          ? `Email send failed (${emailError}). Use the sign-in link below.`
          : 'Use the sign-in link below.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected sign-in error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
