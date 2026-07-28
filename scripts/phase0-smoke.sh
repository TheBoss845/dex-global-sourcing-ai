#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
env -u NODE_ENV pnpm build

echo "Phase 0/1 smoke build OK"
