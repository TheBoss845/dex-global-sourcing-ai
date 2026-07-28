# AGENTS.md

## Cursor Cloud specific instructions

This repo is an early **Phase 0 foundation** monorepo (pnpm workspaces). `apps/*` and
`packages/*` are currently empty scaffolding (`.gitkeep`), so there is **no runnable app,
dev server, lint config, or test runner yet**. Do not assume one exists until a package
adds it.

### Toolchain
- Node 20+ and pnpm 9 (pinned via `packageManager` in `package.json`). The VM already has
  a compatible Node and pnpm.
- Install deps with `pnpm install` only. A `preinstall` guard rejects npm/yarn — using
  `pnpm` satisfies it automatically.

### Verify the environment
- `pnpm typecheck:base` — typechecks `tooling/typescript/verify/noop.ts` against the shared
  strict `tsconfig.base.json`. This is currently the only end-to-end verification target.

### Non-obvious gotchas
- `tsconfig.base.json` sets `lib: ["ES2022"]` with no ambient DOM/Node types. Packages that
  need `console`/`process` must add `"types": ["node"]` (and `@types/node`) in their own
  tsconfig; the base config deliberately stays compiler-options only.
- The base config enables `noUncheckedIndexedAccess`, so indexed access is `T | undefined`.
  This is intentional and will surface in strict typechecks.
- When adding a real app/package, wire per-package `lint`/`test`/`build`/`dev` scripts and
  update this section with how to run them.
