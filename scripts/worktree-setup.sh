#!/usr/bin/env bash
# Prepares a git worktree for parallel module work: hard-linked node_modules, its own local
# Supabase stack (STACK_SLOT) and e2e fixtures. Usage: scripts/worktree-setup.sh <slot 1..9> <main checkout>
set -euo pipefail
SLOT="${1:?slot}"
MAIN="${2:?main checkout path}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Hard-linked copy: Turbopack refuses a node_modules symlink that points outside the project.
[ -e node_modules ] || cp -al "$MAIN/node_modules" node_modules
rm -f .env.local
mkdir -p .local-supabase/bin
STACK_SLOT="$SLOT" STACK_BIN_FROM="$MAIN/.local-supabase/bin" scripts/local-supabase/start.sh --reset > .local-supabase/start.log 2>&1 \
  || { tail -30 .local-supabase/start.log; exit 1; }
npx tsx scripts/seed/index.ts --e2e > .local-supabase/seed.log 2>&1 || { tail -30 .local-supabase/seed.log; exit 1; }
echo "✓ worktree ready: stack slot $SLOT ($(grep NEXT_PUBLIC_SUPABASE_URL .env.local)), run e2e with E2E_PORT=$((3100 + 10 * SLOT))"
