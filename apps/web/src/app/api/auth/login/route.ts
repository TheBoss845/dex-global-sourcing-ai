import { NextResponse } from 'next/server';
import {
  authConfigured,
  authRequired,
  createSessionToken,
  isAllowedEmail,
  normalizeEmail,
  sessionSecret,
} from '@/lib/auth';

export async function POST(request: Request) {
  if (!authRequired()) {
    return NextResponse.json({ ok: true, authRequired: false });
  }

  if (!authConfigured()) {
    return NextResponse.json(
      {
        error:
          'Server misconfigured: set AUTH_SECRET and DEX_ALLOWED_EMAILS (comma-separated emails)',
      },
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
    return NextResponse.json({ error: 'Enter a valid work email address' }, { status: 400 });
  }

  if (!isAllowedEmail(email)) {
    return NextResponse.json(
      { error: 'That email is not authorized for this assistant' },
      { status: 401 },
    );
  }

  const token = await createSessionToken(sessionSecret()!, email);
  const response = NextResponse.json({ ok: true, authRequired: true, email });
  response.cookies.set('dex_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}
