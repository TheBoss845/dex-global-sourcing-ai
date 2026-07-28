import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@dex/db';
import { createSessionToken, isAllowedEmail, sessionSecret } from '@/lib/auth';
import { appBaseUrl } from '@/lib/email';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
    <style>
      body{font-family:system-ui,sans-serif;background:#eef2f6;color:#15202b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
      .card{background:#fff;border:1px solid #cfd8e3;border-radius:12px;padding:28px;max-width:420px}
      a{color:#1f4b99}
    </style></head><body><div class="card">${body}</div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawToken = url.searchParams.get('token')?.trim() ?? '';
  const home = appBaseUrl(request);

  if (!rawToken) {
    return htmlPage(
      'Verification failed',
      `<h1>Missing token</h1><p>This verification link is invalid.</p><p><a href="${home}">Back to DEX</a></p>`,
    );
  }

  const secret = sessionSecret();
  if (!secret) {
    return htmlPage(
      'Verification failed',
      `<h1>Server misconfigured</h1><p>AUTH_SECRET is missing.</p><p><a href="${home}">Back to DEX</a></p>`,
    );
  }

  const tokenHash = hashToken(rawToken);
  const record = await prisma.emailVerificationToken.findUnique({
    where: { token: tokenHash },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return htmlPage(
      'Verification failed',
      `<h1>Link expired or invalid</h1><p>Request a new sign-in link from the app.</p><p><a href="${home}">Back to DEX</a></p>`,
    );
  }

  // Reject verification for addresses outside the allow policy, even if token exists.
  if (!isAllowedEmail(record.email)) {
    await prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return htmlPage(
      'Verification rejected',
      `<h1>Email not allowed</h1><p>Only <strong>@dex.com</strong> emails and explicitly allowed addresses can sign in.</p><p><a href="${home}">Back to DEX</a></p>`,
    );
  }

  await prisma.emailVerificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  const session = await createSessionToken(secret, record.email);
  const response = NextResponse.redirect(home);
  response.cookies.set('dex_session', session, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}
