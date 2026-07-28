# Engineering Handoff — DEX Global Sourcing Assistant

Production: **https://dex-global-sourcing-ai.netlify.app** (Netlify, serverless mode)
Repository: **https://github.com/TheBoss845/dex-global-sourcing-ai** (branch `main` is deployed)

## What it does

Buyers paste a parts list (SupplyItNow rows, spreadsheets, free text) or a single
product link / part number / product name. For each part the system finds up to
10 external vendors with prices, stock, lead times, and sales contact emails,
verified by a ten-stage pipeline (see [pipeline.md](pipeline.md)), and produces
a consolidated report (Excel / CSV / print view / optional email delivery).

## Repository layout

| Path | Purpose |
|------|---------|
| `apps/web` | Next.js 15 app — UI, all API routes, auth, exports, serverless pipeline driver |
| `apps/worker` | BullMQ worker (Redis mode only; not used on Netlify) |
| `packages/core` | Pipeline stages, search/job services, budgets, security (SSRF), money parsing |
| `packages/ai` | All OpenAI calls + procurement domain knowledge base (`knowledge.ts`) |
| `packages/integrations` | Tavily search, HTTP fetcher, page extractors (offer/identity/image/email) |
| `packages/db` | Prisma schema, migrations, client |
| `packages/knowledge` | Supplier-history knowledge store (suggestions, outcomes) |
| `docs/` | `pipeline.md`, `netlify.md`, `render.md`, `architecture.md`, this file |

## Two execution modes

1. **Serverless (production, Netlify)** — no Redis, no worker. `QUEUE_DRIVER=inline`.
   The dashboard polls `POST /api/searches/[id]/tick`; each tick advances one
   bounded step (chunked searches, 2-candidate parallel extraction, split
   normalize/enrich) sized to fit Netlify's ~10s function kill limit.
   Client keeps the tab open; state survives refresh via localStorage resume.
2. **Worker (Render/docker)** — `render.yaml` provisions web + worker + Postgres
   + Redis; stages chain through BullMQ queues; tick endpoint no-ops.

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | yes | Postgres. On Netlify, `NETLIFY_DATABASE_URL` (one-click Neon) is auto-detected |
| `AUTH_SECRET` | recommended | Session signing; falls back to a DATABASE_URL derivation |
| `TAVILY_API_KEY` | yes | Web search for vendor discovery |
| `OPENAI_API_KEY` | recommended | Enables all AI stages; AI auto-enables when present (`AI_ENABLED=false` to opt out) |
| `OPENAI_MODEL` | no | default `gpt-4o-mini` |
| `RESEND_API_KEY` + `EMAIL_FROM` | no | Enables sign-in email verification + emailed finished reports |
| `APP_BASE_URL` | no | Falls back to Netlify `URL` / Render `RENDER_EXTERNAL_URL` |
| `DEX_EXTRA_ALLOWED_EMAILS` | no | Extra sign-in addresses beyond `@dex.com` |
| `EXCLUDED_VENDOR_DOMAINS` | no | Extra domains to ban from vendor results (DEX properties are always banned) |
| `REDIS_URL` / `QUEUE_DRIVER` | worker mode only | unset on Netlify |

## Guarantees the code enforces

- **Grounded AI**: every AI output is validated deterministically (part numbers
  must appear verbatim in source text; photos only removed on confident
  mismatch; every AI stage fails open to deterministic logic).
- **No invented data**: missing price/stock renders as "On request"/"—", never a guess.
- **DEX never appears as a vendor** (own-domain exclusion at three layers).
- **Auth**: `@dex.com` (+ allowlist) only; sessions HMAC-signed; API routes and
  `/report/*` pages middleware-protected; rate limits on login/search/batch.
- **Safe fetching**: SSRF guards (private IP/host blocking), size and time caps,
  CSV formula-injection sanitization, no secrets in the repo.

## Development

```bash
docker compose up -d          # Postgres + Redis
cp .env.example .env          # add keys
pnpm install && pnpm db:generate && pnpm db:migrate
pnpm --filter @dex/worker start   # worker mode
pnpm --filter @dex/web dev        # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

To exercise serverless mode locally: run web with `QUEUE_DRIVER=inline` and no
`REDIS_URL`, and drive jobs via `POST /api/searches/[id]/tick`.

## Known limitations / roadmap candidates

- Bot-walled distributors (DigiKey, Mouser) rarely appear — integrate their
  official APIs (or Octopart) for authoritative pricing/stock. Biggest win.
- Serverless mode requires an open tab while a report runs (mitigated by
  resume + partial downloads + emailed report).
- Report history UI, saved lists, and team roles are intentionally not built yet.
- Vendor sales emails are scraped from vendor pages — present only when published.
