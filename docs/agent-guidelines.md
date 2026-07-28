# Agent & contributor guidelines

This repository is designed for **concurrent human and AI coding agents**.

## Before you change code

1. Read `docs/architecture.md` (frozen).
2. Identify the **single package or app** you own for this change.
3. Do not cross package boundaries via deep imports.
4. Do not expand scope beyond the assigned task/phase item.

## How to add a supplier adapter

1. Add a module under `packages/integrations/src/suppliers/`.
2. Implement `SourceDiscovery` and/or `SourceResolve`.
3. Register it in the integrations public index.
4. Add HTML/JSON **fixtures** + contract tests (no live network in CI).
5. Document rate limits in a `SiteProfile`.

## How to add a queue stage

1. Define the stage name in core constants.
2. Add a worker handler that loads work **by ID only**.
3. Emit `JobEvent` progress; write idempotently.
4. Update architecture phase notes only via ADR if behavior changes contracts.

## How to extend the Supplier Knowledge Base

1. Change schema in `packages/db` with a migration.
2. Put scoring/pure logic in `packages/knowledge`.
3. Wire read/write through `KnowledgeAssist` / `KnowledgeLearner` only.
4. Never let knowledge override deterministic MPN match failures.

## What not to do

- Do not put business logic in Next.js route handlers.
- Do not use Playwright as the default fetcher.
- Do not call LLMs inside extractors.
- Do not store HTML blobs in Postgres.
- Do not invent new top-level packages without an ADR.

## PR hygiene

- One concern per PR
- Tests for new behavior
- Update the relevant package README if public API changes
