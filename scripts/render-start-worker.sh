#!/usr/bin/env bash
set -euo pipefail

corepack enable
corepack prepare pnpm@9.15.9 --activate

pnpm --filter @dex/worker start
