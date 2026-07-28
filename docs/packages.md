# Package boundaries

See also frozen architecture §18.

| Package | May depend on | Must not depend on |
|---------|---------------|--------------------|
| `@dex/web` | `core`, `db` | `integrations` browser code, Playwright, `worker` |
| `@dex/worker` | `core`, `db`, `integrations`, `ai`, `knowledge` | `web` |
| `@dex/core` | `db`, `integrations`, `ai`, `knowledge` | Next.js, Playwright |
| `@dex/knowledge` | `db` | Playwright, Next.js, `integrations` |
| `@dex/integrations` | HTTP/Playwright libs | `web`, `ai` (keep extractors deterministic) |
| `@dex/ai` | vendor SDKs (optional) | Playwright |
| `@dex/db` | Prisma | everything else |

Public API surfaces are package root exports only.
