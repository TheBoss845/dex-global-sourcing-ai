#!/usr/bin/env bash
# Shared Render build for web / worker services.
set -euo pipefail

TARGET="${1:-web}"

corepack enable
corepack prepare pnpm@9.15.9 --activate

# Keep devDependencies (tsx, prisma CLI, typescript) available for build + start.
PNPM_PRODUCTION=false pnpm install --frozen-lockfile

pnpm db:generate
pnpm --filter @dex/db build
pnpm --filter @dex/ai build
pnpm --filter @dex/integrations build
pnpm --filter @dex/knowledge build
pnpm --filter @dex/core build

if [[ "$TARGET" == "web" ]]; then
  pnpm --filter @dex/web build
fi
