# DEX Global Sourcing Assistant — Frozen Architecture

**Status:** FROZEN  
**Version:** 1.1  
**Applies to:** Phases 0–6 implementation

This document is the source of truth. Implementation must follow it. Changes require an explicit architecture amendment.

---

## 1. Purpose & non-goals

**Purpose:** Help DEX purchasing staff find and compare worldwide suppliers for an exact manufacturer part number (MPN), starting from a SupplyItNow URL or raw MPN.

**Non-goals (v1):** Guaranteed global completeness; automatic purchasing; unsupervised counterfeit takedowns; multi-region active-active.

**Coverage contract:** Best-effort discovery across configured distributor integrations and web search, ranked by normalized USD price, with source, confidence, and freshness metadata.

---

## 2. System overview

```
apps/web (Next.js BFF)
    → packages/core (domain orchestration)
        → packages/db (Postgres)
        → packages/integrations (search / suppliers / fetch)
        → packages/ai (optional enrichers)
        → packages/knowledge (supplier knowledge base reads/writes)
    → Redis / BullMQ (multi-queue)
        → apps/worker
Artifacts → local FS / MinIO / S3
```

---

## 3. Repository layout

```
apps/web
apps/worker
packages/core
packages/db
packages/integrations
packages/ai
packages/knowledge          # supplier knowledge base (learning layer)
tooling/
docker-compose.yml
docs/
  architecture.md           # this file (frozen)
  packages.md
  agent-guidelines.md       # AI-agent collaboration rules
  runbooks/
```

`packages/core` remains the only place for business orchestration. A future `apps/api` may wrap `packages/core` without rewriting domain logic.

---

## 4. Domain model

- `Organization` + `org_id` on jobs
- `Part` with normalized MPN
- `SearchJob` status state machine
- Job-scoped `Offer` snapshots
- `Supplier` keyed by registrable domain
- `PartSearchCache` with TTL
- `JobCandidate` child work items
- Artifacts external; DB stores hash + storage key
- **Supplier Knowledge Base entities** (see §16)

### Job statuses

`queued → resolving → discovering → extracting → normalizing → enriching → completed | completed_with_errors | failed | cancelled`

---

## 5. Pipeline

1. Validate input (MPN or allowlisted SupplyItNow URL — SSRF-safe)
2. Cache check (`forceRefresh` bypass)
3. **Knowledge assist (read-only):** suggest preferred suppliers / historically strong domains for this MPN or manufacturer — **does not replace discovery**
4. Resolve part (HTTP-first; Playwright if `SiteProfile.requiresBrowser`)
5. Discover (tier-1 adapters + adaptive SERP under `JobBudget`)
6. Gate candidates (score, caps, denylist; knowledge scores may boost, never sole admit)
7. Extract / resolve offers
8. Normalize (FX `asOf`, dedupe, USD sort)
9. Enrich optionally (AI gray-zone / outliers / summary)
10. Complete + update cache
11. **Knowledge learn (async write):** update supplier stats from job outcomes

**Match policy:** Deterministic normalized MPN match required by default. AI is advisory. Knowledge scores are advisory ranking signals only.

---

## 6. Integrations

- `SearchProvider` + cache + quota
- `SourceDiscovery` / `SourceResolve`
- `SiteProfile` (`requiresBrowser`, rate limits)
- `HttpFetcher` default; `BrowserFetcher` for Playwright
- Per-domain circuit breakers

---

## 7. AI

- Off unless `AI_ENABLED=true`
- Structured snippets only — not full HTML by default
- Batched, budget-capped, gray-zone gated
- “AI suggests, rules decide”

---

## 8. API (BFF)

- `POST /api/searches`
- `GET /api/searches/:id`
- `GET /api/searches/:id/events`
- `GET /api/searches/:id/results`
- `POST /api/searches/:id/cancel`
- `GET /api/searches/:id/export?format=csv|xlsx`

Handlers validate with Zod and call `packages/core` only.

---

## 9. UI

Professional DEX dashboard: brand-forward shell, search, progress, sortable/searchable results, CSV/Excel, dark mode, responsive. Show source tier, confidence, knowledge hints (e.g. preferred), and partial-success state transparently.

---

## 10. Security

- SupplyItNow host allowlist; deny private/link-local IPs; HTTPS only
- Auth required before non-local deploy
- Org-scoped queries for multi-user
- Rate limit job creation
- Never log secrets or full page bodies

---

## 11. Reliability & ops

- Timeouts/heartbeats; retries + DLQ
- Idempotent offer upsert `(job_id, product_url)`
- Partial success status
- Structured logs with `jobId` / `traceId`
- Metrics: duration, cache hit, cost proxies, source error rates, knowledge hit rate

---

## 12. Testing

- Unit: normalize/money/FX/budgets/knowledge scoring
- Fixture contract tests per adapter (no live scraping in CI)
- Pipeline integration with mocked HTTP/search
- Staging canaries

---

## 13. Deployment

| Service | Role |
|---------|------|
| `web` | Next.js |
| `worker` | Non-browser queues |
| `worker-browser` | Playwright queues |
| `postgres` | Primary + knowledge store |
| `redis` | BullMQ |
| object storage | Artifacts |

Scale order: cache → API adapters → queue concurrency → browser pool → DB archival.

---

## 14. Cost controls

`JobBudget` caps SERP queries, candidates, browser navigations, AI tokens, wall-clock timeout.

---

## 15. Scale (100k jobs/day)

Requires high MPN cache hit rate, API-heavy resolution, parent/child jobs, multi-queue workers, HTTP-first fetch. Browser-per-job is rejected.

---

## 16. Supplier Knowledge Base (learning layer)

### 16.1 Intent

Every completed sourcing job contributes to an internal **Supplier Knowledge Base** that improves future searches **without replacing** deterministic discovery, matching, or budgets.

Knowledge is a **soft prior**: it can reorder, boost, or deprioritize candidates and suggest which adapters/domains to try first. It must never be the only reason an offer is accepted or rejected when deterministic MPN rules disagree.

### 16.2 Package boundary

`packages/knowledge` owns:

- Read models / query services for pipeline assist
- Write models / aggregators for post-job learning
- Pure scoring functions (unit-tested, no I/O in scorers)

`packages/core` orchestrates *when* to read/write knowledge.  
`packages/db` owns persistence schema.  
`packages/integrations` must not write knowledge directly (avoids hidden coupling).

### 16.3 Core entities (logical)

| Entity | Purpose |
|--------|---------|
| `SupplierProfile` | Canonical supplier (domain key), countries served, preferred flag |
| `SupplierManufacturer` | Manufacturers this supplier has successfully listed |
| `SupplierMpnStat` | Per-supplier × normalized MPN success/frequency stats |
| `SupplierPriceObservation` | Append-only price points (currency, USD, observedAt, jobId) for trends |
| `SupplierReliability` | Rolling reliability score, health status, consecutive failures/successes |
| `SupplierQualityStat` | Average extraction/match quality, completeness of fields |
| `KnowledgeEvent` | Audit of learn operations (jobId, eventType, payload summary) |

Org-scoped where multi-tenant (`org_id`); global supplier identity remains domain-based.

### 16.4 Signals learned from each job

From successful / partial jobs (deterministic facts only):

- Manufacturers supplied (from matched offers)
- Countries served (from offer/supplier country)
- Historical pricing observations (price, currency, priceUsd, timestamp)
- Successful search counts and last-success-at
- Search frequency (job touches for domain/MPN)
- Reliability / health (extract success vs failure, timeout, blocked)
- Response quality (fraction of required fields present; match confidence avg)
- Preferred suppliers (explicit user mark **or** rule-based promotion after sustained high reliability — never silent AI-only promotion)

### 16.5 Pipeline integration

**Assist (before/during discover):**

```ts
interface KnowledgeAssist {
  suggestSuppliers(input: {
    normalizedMpn: string;
    manufacturer?: string;
    orgId?: string;
    limit: number;
  }): Promise<KnowledgeSuggestion[]>;
}

interface KnowledgeSuggestion {
  supplierDomain: string;
  score: number;          // 0..1 advisory
  reasons: string[];      // explainable, logged
  preferred: boolean;
}
```

Suggestions feed the discover planner as **priority hints** under the same `JobBudget`.

**Learn (after job terminal state):**

```ts
interface KnowledgeLearner {
  recordJobOutcome(jobId: string): Promise<void>;
}
```

Runs on queue `jobs-knowledge` (async, durable, idempotent on `jobId`). Failures must not fail the user-facing job.

### 16.6 Scoring principles

- Deterministic formulas in `packages/knowledge` (documented weights)
- Inputs are aggregated stats, not raw LLM judgments
- AI may later *explain* trends; it must not be the sole writer of reliability scores in v1
- All scores versioned (`scoringVersion`) so formulas can evolve safely

### 16.7 Privacy & retention

- Price observations are business-sensitive: org-scoped access
- Retention/archival policy aligned with job archival
- No scraping of competitor sites solely to fill knowledge — knowledge derives from *our* job outcomes and configured sources

---

## 17. AI-Friendly Architecture (multi-agent collaboration)

Assume multiple human engineers and AI coding agents work in this repository concurrently.

### 17.1 Design rules

1. **Small modules, single purpose** — one folder ≈ one responsibility; prefer many small files over god-modules.
2. **Stable interfaces at boundaries** — public exports via package `index.ts` only; deep imports discouraged.
3. **No hidden dependencies** — no reach-ins to another package’s internals; no ambient globals; config via typed `loadEnv`.
4. **Explicit orchestration** — `packages/core` wires modules; adapters do not call each other sideways.
5. **Independently testable** — every package has unit tests that run without Docker when logic is pure; I/O behind interfaces.
6. **Documented contracts** — each package has a short README: purpose, public API, non-goals, dependency rules.
7. **Task-sized changes** — features land as vertical slices with clear ownership (one queue stage, one adapter, one UI section).
8. **Deterministic before probabilistic** — scrapers, FX, sort, budgets, MPN match are code; AI/knowledge are advisory layers.
9. **Idempotent writes** — safe for concurrent workers and retried jobs.
10. **Agent-readable docs** — keep `docs/agent-guidelines.md` updated with “how to add an adapter”, “how to add a queue stage”, “what not to touch”.

### 17.2 Concurrency conventions for agents

- One PR / one concern; do not mix unrelated refactors
- Do not change frozen architecture without an ADR in `docs/adr/`
- Prefer extending interfaces over modifying call sites broadly
- Add/update tests in the same change as behavior
- Leave `CONTRIBUTING` touchpoints (package README + agent guidelines) current

### 17.3 Interface stability tiers

| Tier | Examples | Change policy |
|------|----------|---------------|
| **Frozen** | Architecture doc, coverage contract, package boundaries | ADR required |
| **Stable** | `SourceDiscovery`, `KnowledgeAssist`, job status enum | Versioned / careful migration |
| **Volatile** | Site selectors, SERP query strings, UI copy | Freely iterable with fixtures |

---

## 18. Package dependency rules

```
apps/web            → core, db
apps/worker         → core, db, integrations, ai, knowledge
packages/core       → db, integrations, ai, knowledge (orchestration only)
packages/knowledge  → db (no Playwright, no Next)
packages/integrations → may use Playwright / HTTP
packages/ai         → optional vendor SDKs; no Playwright
packages/db         → Prisma only
```

Apps must not import each other. `core` must not import Next.js or Playwright.

---

## 19. Phase map

| Phase | Focus |
|-------|--------|
| 0 | Monorepo foundation |
| 1 | Data model, jobs API, UI shell, queues |
| 2 | SupplyItNow + SSRF allowlist |
| 3 | Discovery + adapters |
| 4 | Extract, dedupe, FX, rank |
| 5 | AI enrichment |
| 6 | Export, auth, hardening |
| *Knowledge MVP* | Schema + assist/learn hooks land with Phases 1 & 4; scoring polish can track Phase 5–6 |

---

## Amendment log

| Ver | Change |
|-----|--------|
| 1.0 | Final architecture after critical review |
| 1.1 | Supplier Knowledge Base (§16); AI-Friendly Architecture (§17); `packages/knowledge` |
