import { NextResponse, type NextRequest } from 'next/server';
import {
  apiKeyMatches,
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

  const secret = sessionSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'Server misconfigured: DEX_API_KEY is required in production' },
      { status: 503 },
    );
  }

  const headerKey = request.headers.get('x-api-key');
  const cookieToken = request.cookies.get('dex_session')?.value;
  if (apiKeyMatches(headerKey, secret) || (await verifySessionToken(cookieToken, secret))) {
    return NextResponse.next();
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export const config = {
  matcher: ['/api/:path*'],
};
