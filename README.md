# DEX Global Sourcing Assistant

AI-powered worldwide supplier discovery for DEX purchasing teams.

## Architecture

The architecture is **frozen**. Read:

- [docs/architecture.md](docs/architecture.md) — system design (incl. Supplier Knowledge Base & AI-friendly module rules)
- [docs/packages.md](docs/packages.md) — package boundaries
- [docs/agent-guidelines.md](docs/agent-guidelines.md) — human/AI contributor rules

## Status

Phase 0 foundation in progress. Implementation proceeds one checklist task at a time.

## Tooling

- Node.js 20+
- pnpm 9+ (`packageManager` pinned in root `package.json`)
- TypeScript base config: [`tsconfig.base.json`](tsconfig.base.json) — see [`tooling/typescript/README.md`](tooling/typescript/README.md)

## Planned external providers

| Concern | Provider | Env var (later) |
|---------|----------|-----------------|
| Web search | Tavily | `TAVILY_API_KEY` |
| AI enrichment | OpenAI | `OPENAI_API_KEY` |

Secrets belong in `.env` (gitignored), never in git.
