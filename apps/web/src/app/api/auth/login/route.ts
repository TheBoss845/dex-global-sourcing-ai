import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@dex/db';
import { authConfigured, authRequired, isAllowedEmail, normalizeEmail } from '@/lib/auth';
import { appBaseUrl, emailSendingConfigured, sendVerificationEmail } from '@/lib/email';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
          error:
            'Only @dex.com emails (and explicitly allowed addresses) can sign in.',
        },
        { status: 401 },
      );
    }

    if (!emailSendingConfigured() && process.env.NODE_ENV === 'production') {
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
            'Confirm dex-web start runs migrations (pnpm db:migrate) and DATABASE_URL is set. ' +
            `(${message.slice(0, 180)})`,
        },
        { status: 503 },
      );
    }

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
        ? 'Check your inbox for a verification link.'
        : 'Email provider not configured; use the local verification link.',
    };

    // Never expose magic links in production responses.
    if (process.env.NODE_ENV !== 'production' && !emailSendingConfigured()) {
      payload.devVerifyUrl = verifyUrl;
    }

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected sign-in error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
