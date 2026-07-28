# Package boundaries (architecture v1.2)

| Package | May depend on | Must not depend on |
|---------|---------------|--------------------|
| `@dex/web` | `core`, `db` | Playwright, `worker`, raw HTML artifacts |
| `@dex/worker` | `core`, `db`, `integrations`, `ai`, `knowledge` | `web` |
| `@dex/core` | `db`, `integrations`, `ai`, `knowledge` | Next.js, Playwright |
| `@dex/knowledge` | `db` | Playwright, Next.js, `integrations` |
| `@dex/integrations` | HTTP + optional Playwright; DNS/safe-fetch | `web`, inventing MPNs via AI |
| `@dex/ai` | OpenAI SDK | Playwright; deciding exact-match acceptance alone |
| `@dex/db` | Prisma | everything else |

## Integrations layout (v1.2)

- `fetch/` — SafeHttpFetcher, BrowserFetcher  
- `security/` — DNS/IP/redirect guards shared by fetchers  
- `extractors/generic/` — JSON-LD, OG, labeled DOM, heuristics  
- `extractors/adapters/` — site-specific (SupplyItNow is one adapter, not the product)  
- `search/` — Tavily and future `SearchProvider`s  
- `suppliers/` — distributor API adapters  

## Queues (BullMQ)

`jobs-validate` · `jobs-resolve` · `jobs-discover` · `jobs-extract` · `jobs-normalize` · `jobs-rank` · `jobs-enrich` · `jobs-knowledge`  

(Exact queue split may collapse adjacent stages in early implementation, but stage names in events must match the v1.2 pipeline.)
