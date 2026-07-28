export type SearchHit = {
  title: string;
  url: string;
  content?: string;
  score?: number;
};

export interface SearchProvider {
  readonly id: string;
  search(query: string, options?: { maxResults?: number }): Promise<SearchHit[]>;
}

export type OfferDraft = {
  mpn?: string;
  manufacturer?: string;
  description?: string;
  priceText?: string;
  currency?: string;
  availability?: string | null;
  stockQuantity?: number | null;
  leadTime?: string | null;
  moq?: number | null;
  country?: string | null;
  supplierName?: string | null;
};

export type ExtractedPart = {
  mpn: string;
  manufacturer?: string;
  description?: string;
};

export type SiteProfile = {
  domain: string;
  requiresBrowser: boolean;
  rateLimitPerMinute?: number;
};
