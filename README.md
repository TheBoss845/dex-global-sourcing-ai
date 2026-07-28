# DEX Global Sourcing Assistant

**Data Exchange Corporation (DEX)** — internal sourcing platform.

Paste a **public product-page URL** → click **Find Suppliers** → get the identified MPN and about **10** worldwide supplier options (best-effort).

## Architecture

See [docs/architecture.md](docs/architecture.md) (v1.2 URL-first).

## Run locally

### 1. Prerequisites

- Node.js 20+
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.9 --activate`)
- PostgreSQL 16 and Redis 7  
  - easiest: `docker compose up -d`  
  - or local services on `localhost:5432` / `localhost:6379`

### 2. Configure env

```bash
cp .env.example .env
```

Set at least:

```bash
DATABASE_URL=postgresql://dex:dex@localhost:5432/dex_sourcing?schema=public
REDIS_URL=redis://localhost:6379
TAVILY_API_KEY=tvly-...
OPENAI_API_KEY=sk-...
AI_ENABLED=true
RESULT_LIMIT=10
# Sign-in: @dex.com emails + optional extras (e.g. owner Gmail)
AUTH_SECRET=long-random-string
# DEX_EXTRA_ALLOWED_EMAILS=lmfelcher@gmail.com
# Real email verification (6-digit code + magic link) activates when both are set:
# RESEND_API_KEY=re_...
# EMAIL_FROM=DEX Sourcing <noreply@your-verified-domain.com>
# APP_BASE_URL=https://your-app.onrender.com
```

**Supported pages:** public product pages. Pages with a labeled manufacturer part number identify precisely; retail pages without one fall back to grounded AI identification, then the page's own product title.

**Sign-in:** Users enter an **@dex.com** email (or an explicitly allowed address such as the owner Gmail). With Resend configured, they receive a branded verification email with a 6-digit code and one-click link; without Resend, allowed emails sign in instantly.

**Health:** `GET /api/health`

### 3. Install & migrate

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
```

If you use Docker Compose defaults, create DB user/db once (or rely on the compose postgres image env).

### 4. Start worker + web (two terminals)

```bash
# terminal 1 — pipeline worker
pnpm --filter @dex/worker start

# terminal 2 — dashboard
pnpm --filter @dex/web dev
```

Open **http://localhost:3000**

### 5. Test the product flow

1. Paste any public distributor/manufacturer product URL (HTTPS).  
2. Click **Find Suppliers**.  
3. Watch progress stages; confirm identified manufacturer + MPN above the table.  
4. Review ~10 supplier rows; export CSV/Excel if desired.

If the page does not contain a confident MPN, the job fails with a clear explanation (no guessing).

## Deploy

Two supported hosts — the same repo powers both:

### Netlify (serverless — no Redis/worker needed)

See **[docs/netlify.md](docs/netlify.md)**. Short version:

1. Create a free Postgres at [neon.tech](https://neon.tech), copy the connection string
2. [Netlify](https://app.netlify.com) → **Add new site** → import `TheBoss845/dex-global-sourcing-ai` (`main`)
3. Add env vars: `DATABASE_URL` (Neon), `AUTH_SECRET`, `TAVILY_API_KEY`, `OPENAI_API_KEY`
4. Deploy → open `/api/health` → sign in with `@dex.com` or `lmfelcher@gmail.com`

### Render (background worker + Redis)

See **[docs/render.md](docs/render.md)** — `render.yaml` creates Web + Worker + Postgres + Redis via **New → Blueprint**.

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm db:migrate`
