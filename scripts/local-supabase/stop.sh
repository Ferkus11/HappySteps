#!/usr/bin/env bash
# Stops the local stack started from this checkout (GoTrue, PostgREST, gateway). Postgres keeps running.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for name in gateway auth postgrest; do
  f="$ROOT/.local-supabase/$name.pid"
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"
done
echo "✓ stopped"
