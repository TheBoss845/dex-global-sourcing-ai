import { isIP } from 'node:net';

export type FetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are allowed');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Private or local hosts are blocked');
  }
  if (isIP(host) === 4) {
    if (
      host === '127.0.0.1' ||
      host === '169.254.169.254' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      throw new Error('Blocked IP address');
    }
  }
  if (isIP(host) === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd'))) {
    throw new Error('Blocked IP address');
  }
  return url;
}

/**
 * SSRF-aware HTTP fetcher (manual redirects, host checks, timeouts, size limits).
 * Pipeline code should prefer @dex/core safeFetchText (DNS-validated).
 */
export class HttpFetcher {
  constructor(
    private readonly userAgent = 'DEX-SourcingBot/0.2 (+https://dex.local)',
    private readonly timeoutMs = 12_000,
    private readonly maxBytes = 2_000_000,
    private readonly maxRedirects = 5,
  ) {}

  async fetchText(url: string): Promise<FetchResult> {
    let current = assertPublicHttpUrl(url);
    const requested = current.toString();

    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) throw new Error('Redirect missing Location header');
          current = assertPublicHttpUrl(new URL(location, current).toString());
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > this.maxBytes) throw new Error('Response too large');
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        return {
          url: requested,
          finalUrl: response.url || current.toString(),
          status: response.status,
          headers,
          body: buffer.toString('utf8'),
        };
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('Too many redirects');
  }
}
