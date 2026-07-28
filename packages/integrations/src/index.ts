export const INTEGRATIONS_FETCH_POLICY = 'http-first' as const;

export type { ExtractedPart, OfferDraft, SearchHit, SearchProvider, SiteProfile } from './types.js';
export type { PartIdentityDraft, IdentityEvidence } from './extractors/identity.js';
export { TavilySearchProvider } from './search/tavily.js';
export { HttpFetcher } from './fetch/http.js';
export { extractSupplyItNowPart } from './extractors/supplyitnow.js';
export { extractContactEmail, extractGenericOffer, extractProductImage } from './extractors/generic.js';
export { extractProductIdentity } from './extractors/identity.js';
