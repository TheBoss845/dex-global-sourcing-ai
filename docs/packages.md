# Package boundaries

See also frozen architecture §18.

| Package | May depend on | Must not depend on |
|---------|---------------|--------------------|
| `@dex/web` | `core`, `db` | Playwright, `worker` |
| `@dex/worker` | `core`, `db`, `integrations`, `ai`, `knowledge` | `web` |
| `@dex/core` | `db`, `integrations`, `ai`, `knowledge` | Next.js, Playwright |
| `@dex/knowledge` | `db` | Playwright, Next.js, `integrations` |
| `@dex/integrations` | HTTP clients (Playwright later when required) | `web`, `ai` |
| `@dex/ai` | vendor SDKs (OpenAI) | Playwright |
| `@dex/db` | Prisma | everything else |

Public API surfaces are package root exports only.

## Queues (BullMQ)

BullMQ disallows `:` in queue names. Use:

`jobs-resolve` · `jobs-discover` · `jobs-extract` · `jobs-normalize` · `jobs-enrich` · `jobs-knowledge`
