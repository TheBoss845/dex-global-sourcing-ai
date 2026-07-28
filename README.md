# DEX Global Sourcing Assistant

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
# Optional strict mode: emailed magic links instead of instant sign-in
# AUTH_REQUIRE_EMAIL_VERIFICATION=true
# RESEND_API_KEY=re_...
# EMAIL_FROM=DEX Sourcing <noreply@your-verified-domain.com>
# APP_BASE_URL=https://your-app.onrender.com
```

**Supported pages:** public HTML product pages that expose a manufacturer part number (JSON-LD, labeled fields, or clear product URL). Bot-walled / JS-only distributor pages may fail honestly until a browser fetcher is added.

**Sign-in:** Users enter an **@dex.com** email (or an explicitly allowed address such as the owner Gmail) and are signed in immediately. Set `AUTH_REQUIRE_EMAIL_VERIFICATION=true` to require emailed magic links via Resend instead.

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

## Deploy on Render

See **[docs/render.md](docs/render.md)**.

Short version:

1. [Render](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect `TheBoss845/dex-global-sourcing-ai` (`main`)
3. Fill secrets when prompted: `TAVILY_API_KEY`, `OPENAI_API_KEY`
4. After deploy: open `https://<your-web>.onrender.com/api/health`, then sign in with an `@dex.com` email or `lmfelcher@gmail.com` (instant — no email link needed)

`render.yaml` creates Web + Worker + Postgres + Redis.

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm db:migrate`
