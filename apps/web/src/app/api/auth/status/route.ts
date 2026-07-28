import { NextResponse } from 'next/server';
import {
  authConfigured,
  authRequired,
  sessionSecret,
  verifySessionToken,
} from '@/lib/auth';
import { emailSendingConfigured } from '@/lib/email';

export async function GET(request: Request) {
  const required = authRequired();
  if (!required) {
    return NextResponse.json({ authRequired: false, configured: true, email: null });
  }

  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)dex_session=([^;]+)/);
  const token = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  const secret = sessionSecret();
  const session = secret ? await verifySessionToken(token, secret) : { ok: false as const };

  return NextResponse.json({
    authRequired: true,
    configured: authConfigured(),
    email: session.ok ? session.email ?? null : null,
    signedIn: Boolean(session.ok),
    allowedDomain: '@dex.com',
    emailVerificationRequired: emailSendingConfigured(),
  });
}
