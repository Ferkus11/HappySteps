#!/usr/bin/env bash
# Mirrors the repository (with .git, without build output) to the shared project folder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-/mnt/project-files/happy-steps}"
rm -rf "$DEST"
mkdir -p "$DEST"
tar -C "$ROOT" --exclude=./node_modules --exclude=./.next --exclude=./.local-supabase --exclude=./test-results \
  --exclude=./playwright-report --exclude=./.env.local -cf - . | tar -C "$DEST" -xf -
