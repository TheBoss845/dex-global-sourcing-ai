import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@dex/db';
import {
  authConfigured,
  authRequired,
  createSessionToken,
  isAllowedEmail,
  isExtraAllowedEmail,
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

    const limited = rateLimit(`login:${clientIp(request)}`, { limit: 10, windowMs: 60_000 });
    if (!limited.allowed) {
      return NextResponse.json({ error: 'Too many sign-in attempts. Try again shortly.' }, { status: 429 });
    }

    let body: { email?: string; ownerCode?: string } = {};
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
          error:
            'That email is not allowed. Use an @dex.com address or lmfelcher@gmail.com.',
        },
        { status: 401 },
      );
    }

    const secret = sessionSecret()!;
    const ownerCode = process.env.AUTH_OWNER_CODE?.trim();
    const providedCode = body.ownerCode?.trim() ?? '';

    // Instant unlock for allowlisted owner email when AUTH_OWNER_CODE matches.
    if (ownerCode && providedCode && isExtraAllowedEmail(email) && providedCode === ownerCode) {
      const session = await createSessionToken(secret, email);
      const response = NextResponse.json({
        ok: true,
        authRequired: true,
        signedIn: true,
        email,
        message: 'Signed in with owner access code.',
      });
      response.cookies.set('dex_session', session, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 12,
      });
      return response;
    }

    if (!emailSendingConfigured() && process.env.NODE_ENV === 'production' && !isExtraAllowedEmail(email)) {
      return NextResponse.json(
        {
          error:
            'Email verification is not configured. Set RESEND_API_KEY and EMAIL_FROM on Render. ' +
            'For a quick test set EMAIL_FROM to: DEX <onboarding@resend.dev>',
        },
        { status: 503 },
      );
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          error:
            'Database error while creating the verification token. ' +
            'Confirm dex-web start runs migrations and DATABASE_URL is set. ' +
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

    const showLink =
      process.env.NODE_ENV !== 'production' ||
      process.env.AUTH_SHOW_VERIFY_LINK === 'true' ||
      (isExtraAllowedEmail(email) && !emailSent);

    // Extra-allowed accounts (owner Gmail) can always open the link if mail fails.
    if (!emailSent && !showLink) {
      return NextResponse.json(
        {
          error:
            emailError ??
            'Could not send verification email. Set EMAIL_FROM to DEX <onboarding@resend.dev> or verify a domain.',
        },
        { status: 502 },
      );
    }

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
