import { NextResponse } from 'next/server';
import { createSessionToken, sessionSecret } from '@/lib/auth';

export async function POST(request: Request) {
  const secret = sessionSecret();
  if (!secret) {
    return NextResponse.json({ ok: true, authRequired: false });
  }

  let body: { key?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.key || body.key !== secret) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  const token = await createSessionToken(secret);
  const response = NextResponse.json({ ok: true, authRequired: true });
  response.cookies.set('dex_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}
