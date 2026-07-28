export type FetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

export class HttpFetcher {
  constructor(
    private readonly userAgent = 'DEX-SourcingBot/0.1 (+https://dex.local)',
    private readonly timeoutMs = 12_000,
  ) {}

  async fetchText(url: string, init?: RequestInit): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...(init?.headers ?? {}),
        },
      });

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        url,
        finalUrl: response.url,
        status: response.status,
        headers,
        body,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
