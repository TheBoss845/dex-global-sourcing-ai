import { NextResponse, type NextRequest } from 'next/server';
import {
  apiKeyMatches,
  authConfigured,
  authRequired,
  sessionSecret,
  verifySessionToken,
} from '@/lib/auth';

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/status',
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (!authRequired()) {
    return NextResponse.next();
  }

  if (!authConfigured()) {
    return NextResponse.json(
      {
        error: 'Server misconfigured: set AUTH_SECRET for production sign-in',
      },
      { status: 503 },
    );
  }

  const secret = sessionSecret()!;
  const headerKey = request.headers.get('x-api-key');
  if (apiKeyMatches(headerKey)) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get('dex_session')?.value;
  const session = await verifySessionToken(cookieToken, secret);
  if (session.ok) {
    return NextResponse.next();
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export const config = {
  matcher: ['/api/:path*'],
};
