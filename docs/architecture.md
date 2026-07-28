# DEX Global Sourcing Assistant — Architecture

**Status:** Implemented (v1.2 URL-first)  
**Version:** 1.2  
**Supersedes:** 1.1 (SupplyItNow-or-MPN input model)

This document is the source of truth for the URL-first product workflow.

---

## 1. Purpose & non-goals

**Purpose:** Help DEX purchasing staff find and compare worldwide suppliers for an exact manufacturer part number (MPN). The **only required user input** is a public product-page URL from any supplier, distributor, manufacturer, marketplace, or industrial-parts site.

**Primary UX:**

1. Paste a product-page URL  
2. Click **Find Suppliers**  
3. See the identified manufacturer + exact MPN, then **approximately 10** useful supplier results  

The user must **not** be required to enter MPN, manufacturer, description, supplier name, specs, or keywords.

**Non-goals (v1):**

- Guaranteed global completeness (“entire internet”)  
- Automatic purchasing / checkout  
- Inventing an MPN when the source page is insufficient  
- Unsupervised counterfeit takedowns  
- Multi-region active-active  

**Coverage contract:** Best-effort worldwide supplier discovery across configured adapters, APIs, search providers, and the internal knowledge base — with source, confidence, freshness, and evidence metadata. Never claim complete worldwide coverage.

---

## 2. System overview

```
Browser (URL + Find Suppliers)
    → apps/web (Next.js BFF)
        → packages/core (orchestration only)
            → packages/db
            → packages/integrations  (safe fetch, adapters, extractors, search)
            → packages/knowledge     (advisory priors + learning)
            → packages/ai            (gray-zone only; never invents MPN)
        → Redis / BullMQ
            → apps/worker (+ isolated browser workers when needed)
Artifacts (HTML/JSON) → object storage (never returned raw to clients)
```

---

## 3. Repository layout

Unchanged package topology from v1.1, with clearer integration submodules:

```
apps/web
apps/worker
packages/core
packages/db
packages/integrations
  src/fetch/           # SafeHttpFetcher, BrowserFetcher
  src/security/        # DNS/IP/redirect guards used by fetchers
  src/extractors/
    generic/           # JSON-LD, OG, labeled fields, heuristics
    adapters/          # site-specific adapters (incl. SupplyItNow as one adapter)
  src/search/          # Tavily and future providers
  src/suppliers/       # distributor API adapters
packages/knowledge
packages/ai
docs/
```

SupplyItNow is **not** a privileged input type. It is one optional site adapter.

---

## 4. Domain model (v1.2)

### 4.1 Core entities

| Entity | Role |
|--------|------|
| `Organization` | Multi-tenant ready (`org_id`) |
| `SearchJob` | One Find Suppliers run; owns progress, budgets, source URLs, resolve outcome |
| `Part` | Canonical identified part (original + normalized MPN, manufacturer, etc.) |
| `PartIdentityEvidence` | Why the MPN was chosen (field sources, scores, extractor/adapter ids) |
| `JobCandidate` | Discovered listing URLs; status + **rejection reason** when rejected |
| `Supplier` | Domain-keyed supplier org |
| `Offer` | **Job-scoped** offer snapshot (never invent missing fields) |
| `PartSearchCache` | TTL cache keyed by normalized MPN (+ manufacturer when known) |
| `ExchangeRate` | FX with `asOf` |
| Knowledge entities | Profiles, MPN stats, price observations, reliability (unchanged intent) |
| `JobEvent` | UI progress / audit trail (short retention) |

### 4.2 SearchJob (source resolution)

Must store:

- `rawSourceUrl` — user paste  
- `finalSourceUrl` — after safe redirects  
- `sourceFetchMethod` — `http` \| `browser`  
- `sourceArtifactHash` / `sourceArtifactKey` — private artifact pointer  
- `resolveStatus` — `pending` \| `identified` \| `failed`  
- `identificationConfidence` — 0..1  
- `identificationMethod` — adapter id / generic path  
- `resolveErrorCode` / `resolveErrorMessage` — when stopped  
- budget, progress, summary, timestamps, `traceId`

### 4.3 Part (identity)

Must store:

- `manufacturer` / `brand`  
- `originalMpn` (display)  
- `normalizedMpn` (search key)  
- `supplierSku` (source page’s internal SKU, if any — **not** the search key)  
- `modelNumber`, `title`, `description`  
- `specificationsJson` (optional structured specs)  
- distinction flags / classification notes as needed  

### 4.4 PartIdentityEvidence

One or more rows / JSON blob with:

- candidate value + classification (`mpn` \| `sku` \| `model` \| `stock` \| `catalog` \| `unknown`)  
- source (`json_ld` \| `og` \| `labeled_dom` \| `adapter` \| `meta` \| `heuristic`)  
- selector / path  
- score contribution  
- chosen: boolean  

### 4.5 JobCandidate

Add:

- `rejectionReason` enum/string (`mpn_mismatch`, `substitute`, `accessory`, `pdf_document`, `duplicate`, `mention_only`, `low_confidence`, `fetch_failed`, …)  
- keep status machine: pending → extracting → extracted \| rejected \| failed  

### 4.6 Offer (result row)

Must support table fields:

- supplier name, domain, country  
- manufacturer, manufacturer MPN shown, supplier part number  
- product URL  
- unit price, currency, `priceUsd`  
- optional quantity breaks JSON  
- stock / availability text or qty  
- MOQ, lead time, condition  
- `extractedAt` / last verified  
- `matchConfidence`  
- `sourceType` (`api` \| `search` \| `scrape` \| `cache` \| `knowledge`)  
- `riskFlags[]` / warnings  
- reliability snapshot (copied or joined from knowledge at rank time)  

Missing values remain **null** in storage; UI maps to “Price unavailable”, “Stock unknown”, etc. **Never invent.**

### 4.7 Job statuses (expanded)

`queued → validating → fetching_source → extracting_identity → identifying_mpn → discovering → gating → extracting_offers → validating_matches → normalizing → ranking → enriching → completed | completed_with_errors | failed | cancelled`

(UI may collapse these into fewer human labels; events carry fine-grained stage names.)

---

## 5. Pipeline (final)

1. **Validate URL** — public http(s); SSRF/DNS/redirect/size/time limits  
2. **Fetch source page** — HTTP first; Playwright only if required  
3. **Extract product identity** — generic + adapter layers  
4. **Identify MPN** — classify MPN vs SKU/model/stock/catalog; score  
5. **Normalize & validate MPN** — confidence gate; stop if insufficient  
6. **Check cache** — optional short-circuit / assist (`forceRefresh` bypass)  
7. **Discover worldwide candidates** — adapters, APIs, search providers, knowledge priors  
8. **Gate candidates** — caps, denylist, MPN presence heuristics, budgets  
9. **Fetch & extract listings** — HTTP-first; browser when profiled  
10. **Validate exact matches** — deterministic first; AI gray-zone advisory only  
11. **Normalize supplier & pricing** — FX `asOf`, availability fields  
12. **Deduplicate** — registrable domain; best offer per supplier  
13. **Rank** — ~10 useful results; priced USD asc, then unpriced; never promote suspicious over trustworthy solely on price  
14. **Store results** — job snapshots + cache + knowledge learn (async)  
15. **Display & export** — UI + CSV/Excel  

**Match policy:** Exact normalized manufacturer MPN required for default acceptance. Packaging suffixes, revisions, kits, replacements, substitutes, accessories, mention-only pages, and unrelated PDFs are rejected or separated — not silently treated as identical.

**AI policy:** May advise on gray-zone listing similarity / risk; **must not** invent source MPN; **must not** alone admit a non-exact match.

**Knowledge policy:** Soft prior for discover priority only.

---

## 6. Integrations

### 6.1 Safe fetching

`SafeHttpFetcher` / `BrowserFetcher` share:

- scheme allow http/https  
- block localhost, loopback, private, link-local, cloud metadata IPs  
- DNS resolve → validate **all** addresses before connect  
- redirect hop limit + revalidation per hop  
- response size limit + timeouts  
- no user cookies / auth forwarding  
- browser pool isolated from lite workers  

### 6.2 Product identity extraction

```
SiteAdapter.canHandle(url) → extract(html|page) → PartIdentityDraft
GenericProductExtractor → JSON-LD, OG, labeled DOM, meta, conservative heuristics
IdentityClassifier → tags values as mpn|sku|model|…
MpnIdentifier → chooses MPN + confidence + evidence
```

Adapters are optional accelerators (Digi-Key, Mouser, LCSC, TI, Amazon, SupplyItNow, …). Generic path must work for unknown sites.

### 6.3 Search providers

Provider-independent `SearchProvider` interface (Tavily first). Query planner builds exact-match queries including manufacturer when known; adaptive regional fan-out (not one country only).

### 6.4 Supplier adapters

`SourceDiscovery` / `SourceResolve` for APIs and known distributors. Prefer APIs for precision and cost.

---

## 7. AI

- Disabled unless configured  
- Inputs: structured fields + short snippets — never full HTML to clients; minimize HTML to models  
- Uses: gray-zone same-part advice, description cleanup, job summary, suspicion hints when rules trigger  
- **Forbidden:** inventing MPN; auto-accepting non-exact matches without deterministic gate  

---

## 8. API contracts (BFF)

### `POST /api/searches`

Request (v1 primary):

```json
{ "url": "https://distributor.example/product/...", "forceRefresh": false }
```

Optional later (non-default UX): `{ "mpn": "..." }` for internal/debug only — not shown in first-version UI.

Responses:

- `201` `{ job }` when accepted  
- `400` validation / SSRF / blocked URL  
- Job may later enter `failed` with resolve error if MPN confidence insufficient  

### `GET /api/searches/:id`

Returns job + `part` (manufacturer, originalMpn, normalizedMpn, confidence, evidence summary) + progress + summary. **Does not** include raw HTML.

### `GET /api/searches/:id/events`

Progress events for staged UI.

### `GET /api/searches/:id/results`

Paginated/~10 default offers with table fields; supports filter/sort. Unpriced after priced.

### `POST /api/searches/:id/cancel`

### `GET /api/searches/:id/export?format=csv|xlsx`

Export current job offers (structured fields only).

All handlers validate with Zod and call `packages/core` only.

---

## 9. UI plan (first version)

Single composition:

- Brand **DEX** as primary signal  
- One URL input  
- One primary CTA: **Find Suppliers**  
- Progress stages (mapped from pipeline)  
- **Identified manufacturer** + **identified MPN** + confidence + original source link (above results)  
- Comparison table (~10 rows) with columns:  
  Supplier · Country · Manufacturer · Manufacturer Part Number · Supplier Part Number · Price · Currency · USD Price · Stock · MOQ · Lead Time · Match Confidence · Supplier Reliability · Last Verified · Product Link · Warnings  
- Empty/missing → “Price unavailable” / “Stock unknown” / “Lead time unavailable”  
- CSV + Excel export  
- Clear errors when MPN cannot be identified; partial-success when some candidates fail  
- Dark mode + responsive  
- Coverage language: “best-effort worldwide supplier discovery”  

Remove first-version dual-mode MPN/URL toggle from the primary dashboard.

---

## 10. Security plan

| Control | Requirement |
|---------|-------------|
| Schemes | http/https only |
| Host/IP | Block localhost, loopback, private, link-local, metadata ranges |
| DNS | Resolve before fetch; reject if any answer is blocked (rebinding) |
| Redirects | Cap hops; revalidate every target |
| Limits | Timeout, max bytes, concurrency |
| Credentials | Never send user cookies/auth; no shared cookie jar across jobs |
| Browser | Isolated worker pool; same URL gates before navigation |
| Artifacts | Private storage by hash; never expose fetched HTML to users |
| Auth | Required before shared/staging/prod exposure |
| Tenancy | `org_id` ready; rate-limit job creation |

**Removed as primary control:** SupplyItNow-only host allowlist for product URLs.

---

## 11. Testing strategy

- **Unit:** MPN normalize; identity classifier; confidence gate; money/FX; candidate rejection reasons; ranking (~10, priced first)  
- **SSRF suite:** private IPs, metadata IP, DNS rebinding fixtures, redirect-to-private, oversized body, timeout  
- **Extractor fixtures:** HTML/JSON-LD per adapter + generic pages (no live network in CI)  
- **Pipeline integration:** mocked fetch/search; assert stop-on-low-confidence; assert exact-match gating  
- **Contract tests** for each site adapter before merge  
- **Staging canaries** for critical adapters + Tavily  
- Never depend on live arbitrary URLs in CI  

---

## 12. Reliability, cost, scale

Unchanged principles from v1.1:

- Job budgets (SERP, candidates, browser navigations, AI, wall clock)  
- Target ~10 results (not unbounded)  
- Parent/child work; queue messages are IDs only; DLQ  
- HTTP-first; <10% browser fetches as scale goal  
- Cache by normalized MPN  
- Partial success vs hard fail  

---

## 13. Supplier Knowledge Base

Unchanged role: learn from outcomes; suggest preferred domains; **never** replace deterministic discovery/matching; never invent MPN.

---

## 14. AI-friendly module rules

Unchanged: small modules, stable exports, no hidden deps, package READMEs, ADRs for frozen-contract changes, concurrent human/AI agents.

---

## 15. Implementation roadmap (revised)

| Phase | Focus |
|-------|--------|
| **0** | Monorepo foundation (largely done) |
| **1** | Data model v1.2, URL-only API/UI shell, queues, progress events |
| **2** | **Safe arbitrary-URL fetch** (DNS/IP/redirect/size/time) + **generic identity extraction** + confidence gate + evidence persistence |
| **3** | Worldwide discovery (Tavily + knowledge assist + first distributor adapters) targeting ~10 gated candidates |
| **4** | Listing extract, exact-match validation, FX, dedupe, rank (~10), rejection reasons |
| **5** | AI gray-zone / summary / risk (still no MPN invention) |
| **6** | Export polish, auth, hardening, canaries, ops |
| **Ongoing** | Site adapters for top suppliers to raise resolve + price precision |

Phase 2 is no longer “SupplyItNow allowlist extractor.” SupplyItNow may return later as a normal adapter.

---

## 16. Impact on completed code (must change / remove)

The existing MVP implemented the **old** workflow. After approval, these areas **must** be changed before treating the product as correct:

### Must change

| Area | Current behavior | Required change |
|------|------------------|-----------------|
| UI (`dashboard.tsx`) | MPN **or** URL mode toggle | URL-only + **Find Suppliers**; show identified manufacturer/MPN/confidence above table; expand columns |
| API schema (`createSearchSchema`) | `mpn` or `url` | Primary `{ url }`; MPN optional/internal only |
| `createSearchJob` / resolve stage | SupplyItNow allowlist + `extractSupplyItNowPart` | Safe arbitrary URL validate/fetch; generic+adapter identity pipeline; confidence stop |
| `assertSafeUrl` / env `SUPPLYITNOW_ALLOWED_HOSTS` | Host allowlist as main control | DNS/IP/redirect/size limits; drop allowlist-as-required for product URLs |
| Prisma schema | Thin part/job fields | Add source URLs, evidence, confidence, rejection reasons, richer offer fields |
| Candidate gating | Weak (datasheet filters partial) | Explicit reject reasons: substitutes, kits, PDFs, mention-only, etc. |
| Ranking | Unbounded-ish then table | Explicit ~10 useful results; priced then unpriced; trust before suspicious cheap |
| Copy / README | Mentions SupplyItNow-or-MPN | URL-first UX + coverage contract language |

### Keep (still valid)

- Monorepo layout, BullMQ multi-queue (hyphen names), HTTP-first policy  
- Job-scoped offers + knowledge package pattern  
- Tavily provider abstraction, Frankfurter FX, OpenAI enricher behind flags  
- Export endpoints (extend columns)  
- Core package boundary  

### Remove or demote

- First-class SupplyItNow-only input path and allowlist-centric security story  
- Primary UI path that asks users to type an MPN  
- Treating `extractSupplyItNowPart` as the resolve implementation (keep only as one adapter file if useful)  

**Recommendation:** Do not ship/merge further feature work on the old UX. Implement v1.2 as an intentional refactor starting at Phase 1–2 schema + resolve, then re-wire discover→rank to the ~10 result contract.

---

## Amendment log

| Ver | Change |
|-----|--------|
| 1.0 | Initial post-review architecture |
| 1.1 | Knowledge base + AI-friendly rules |
| 1.2 | **URL-first arbitrary product-page workflow**; generic identity extraction; DNS/SSRF hardening; ~10 result UX; evidence + confidence gate; roadmap & code-impact update |

---

## Approval gate

No new production implementation for this correction until **v1.2 is explicitly approved**.
