#!/usr/bin/env bash
# 手动触发单个仓库同步（MVP 入口）。
# 用法：./scripts/sync.sh <repo-name> [--backfill] [--dry-run] [--target <sha>]
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f dist/cli.js ]; then
  exec node --env-file-if-exists=.env dist/cli.js sync "$@"
else
  exec node --env-file-if-exists=.env --import tsx src/cli.ts sync "$@"
fi
