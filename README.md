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
```

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

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm db:migrate`
