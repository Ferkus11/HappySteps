#!/usr/bin/env bash
# Runs the production standalone build (same artefact as the Docker image).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-3000}"
cd "$ROOT"
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
ENV_ARGS=()
[ -f "$ROOT/.env.local" ] && ENV_ARGS+=(--env-file="$ROOT/.env.local")
export PORT HOSTNAME=0.0.0.0
exec node "${ENV_ARGS[@]}" .next/standalone/server.js
