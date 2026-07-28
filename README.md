# DEX Global Sourcing Assistant

AI-powered worldwide supplier discovery for DEX purchasing teams.

## Architecture

Frozen design: [docs/architecture.md](docs/architecture.md) · [docs/packages.md](docs/packages.md) · [docs/agent-guidelines.md](docs/agent-guidelines.md)

**Coverage contract:** best-effort worldwide discovery across configured sources + Tavily web search, ranked by USD, with confidence/freshness metadata.

## Quick start

```bash
cp .env.example .env
# add TAVILY_API_KEY and OPENAI_API_KEY

docker compose up -d   # or use local Postgres/Redis
pnpm install
pnpm db:generate
pnpm db:migrate

# terminal 1
pnpm --filter @dex/worker start

# terminal 2
pnpm --filter @dex/web dev
```

Open http://localhost:3000

## Providers

| Concern | Provider | Env |
|---------|----------|-----|
| Web search | Tavily | `TAVILY_API_KEY` |
| AI enrichment | OpenAI | `OPENAI_API_KEY`, `AI_ENABLED=true` |
| FX | Frankfurter | none |

## Monorepo

- `apps/web` — Next.js dashboard + BFF
- `apps/worker` — BullMQ multi-queue pipeline
- `packages/core` — domain orchestration
- `packages/db` — Prisma/Postgres
- `packages/integrations` — Tavily, HTTP fetch, extractors
- `packages/knowledge` — supplier knowledge base
- `packages/ai` — OpenAI enrichers

## Scripts

`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm db:migrate`
