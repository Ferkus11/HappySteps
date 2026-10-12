#!/usr/bin/env bash
# Stops the local stack started from this checkout (GoTrue, PostgREST, gateway). Postgres keeps running.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK="$ROOT/.local-supabase"
pkill -f "$STACK/bin/auth serve" 2>/dev/null
pkill -f "$STACK/bin/postgrest $STACK/postgrest.conf" 2>/dev/null
pkill -f "node $ROOT/scripts/local-supabase/gateway.mjs" 2>/dev/null
rm -f "$STACK"/*.pid
echo "✓ stopped"
