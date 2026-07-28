import type { SearchHit, SearchProvider } from '../types.js';

export class TavilySearchProvider implements SearchProvider {
  readonly id = 'tavily';

  constructor(private readonly apiKey: string) {}

  async search(query: string, options?: { maxResults?: number }): Promise<SearchHit[]> {
    if (!this.apiKey) {
      throw new Error('TAVILY_API_KEY is not configured');
    }

    // One retry with backoff: batch reports fire many searches and
    // transient 429/5xx responses must not fail a whole part.
    let response = await this.request(query, options);
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await this.request(query, options);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Tavily search failed: HTTP ${response.status} ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
    };

    return (data.results ?? [])
      .filter((row) => row.url)
      .map((row) => ({
        title: row.title ?? row.url!,
        url: row.url!,
        content: row.content,
        score: row.score,
      }));
  }

  private request(query: string, options?: { maxResults?: number }): Promise<Response> {
    return fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: 'advanced',
        include_answer: false,
        max_results: options?.maxResults ?? 10,
      }),
    });
  }
}
