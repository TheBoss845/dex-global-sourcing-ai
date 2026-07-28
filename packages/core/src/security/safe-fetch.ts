import { assertSafePublicUrl, assertSafeUrl, isBlockedHostnameOrIp } from '../security/url.js';
import { AppError, ErrorCodes } from '../errors.js';

export type SafeFetchResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  body: string;
  headers: Record<string, string>;
};

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
};

/**
 * SSRF-safe HTTP fetch with DNS checks, redirect revalidation, size and time limits.
 * Does not forward cookies or credentials.
 */
export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const userAgent = options.userAgent ?? 'DEX-SourcingBot/0.2 (+https://dex.local)';

  let current = await assertSafePublicUrl(rawUrl, { allowHttp: true });
  const requestedUrl = current.toString();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new AppError(ErrorCodes.ExtractionError, 'Redirect missing Location header');
        }
        const next = new URL(location, current);
        current = await assertSafePublicUrl(next.toString(), { allowHttp: true });
        continue;
      }

      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (contentLength > maxBytes) {
        throw new AppError(ErrorCodes.ExtractionError, 'Response too large');
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        throw new AppError(ErrorCodes.ExtractionError, 'Response too large');
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        requestedUrl,
        finalUrl: response.url || current.toString(),
        status: response.status,
        body: buffer.toString('utf8'),
        headers,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(ErrorCodes.ExtractionError, 'Request timed out', { retryable: true });
      }
      throw new AppError(
        ErrorCodes.ExtractionError,
        error instanceof Error ? error.message : 'Fetch failed',
        { retryable: true, cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new AppError(ErrorCodes.SsrfBlocked, 'Too many redirects');
}

export { assertSafeUrl, assertSafePublicUrl, isBlockedHostnameOrIp };
