#!/usr/bin/env bash
# Docker-less local Supabase stack for development and CI.
# Postgres (system install) + GoTrue (supabase/auth) + PostgREST + a small gateway
# that exposes the Supabase URL layout on :54321 and emulates Storage/Realtime.
#
# Usage: scripts/local-supabase/start.sh [--reset]
# If you have Docker, prefer `npx supabase start` — it uses the same migrations.
#
# STACK_SLOT=N (0..9) runs an independent stack next to the default one (used by parallel
# git worktrees): database happysteps_sN, GoTrue :9999-N, PostgREST :3001+10N, gateway :54321+N.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK="$ROOT/.local-supabase"
BIN="$STACK/bin"
LOGS="$STACK/logs"
mkdir -p "$BIN" "$LOGS" "$STACK/storage"

SLOT="${STACK_SLOT:-0}"
if [ "$SLOT" = "0" ]; then DEFAULT_DB=happysteps; else DEFAULT_DB="happysteps_s$SLOT"; fi
DB_NAME="${LOCAL_DB_NAME:-$DEFAULT_DB}"
AUTH_PORT=$((9999 - SLOT))
PGRST_PORT=$((3001 + 10 * SLOT))
GATEWAY_PORT=$((54321 + SLOT))
export DB_NAME GATEWAY_PORT
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL="psql -h $PGHOST -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q"
JWT_SECRET="${LOCAL_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
AUTH_VERSION="v2.180.0"
PGRST_VERSION="v12.2.3"

download() {
  # Worktrees reuse the binaries of the main checkout when available.
  if [ ! -x "$BIN/auth" ] && [ -n "${STACK_BIN_FROM:-}" ] && [ -x "$STACK_BIN_FROM/auth" ]; then
    cp -r "$STACK_BIN_FROM"/. "$BIN/"
  fi
  if [ ! -x "$BIN/auth" ]; then
    echo "→ downloading supabase/auth $AUTH_VERSION"
    curl -fsSL -o "$STACK/auth.tgz" "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz"
    tar xzf "$STACK/auth.tgz" -C "$BIN" && rm "$STACK/auth.tgz"
  fi
  if [ ! -x "$BIN/postgrest" ]; then
    echo "→ downloading PostgREST $PGRST_VERSION"
    curl -fsSL -o "$STACK/pgrst.txz" "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/postgrest-$PGRST_VERSION-linux-static-x64.tar.xz"
    tar xJf "$STACK/pgrst.txz" -C "$BIN" && rm "$STACK/pgrst.txz"
  fi
}

stop_services() {
  for name in gateway auth postgrest; do
    if [ -f "$STACK/$name.pid" ]; then
      kill "$(cat "$STACK/$name.pid")" 2>/dev/null || true
      rm -f "$STACK/$name.pid"
    fi
  done
  sleep 0.5
}

ensure_postgres() {
  if ! pg_isready -h "$PGHOST" -p "$PGPORT" -q; then
    echo "→ starting postgres"
    (pg_ctlcluster 16 main start 2>/dev/null || sudo pg_ctlcluster 16 main start)
    for _ in $(seq 1 30); do pg_isready -h "$PGHOST" -p "$PGPORT" -q && break; sleep 0.5; done
  fi
}

reset_db() {
  echo "→ recreating database $DB_NAME"
  $PSQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DB_NAME' and pid<>pg_backend_pid()" >/dev/null
  $PSQL -d postgres -c "drop database if exists $DB_NAME"
  $PSQL -d postgres -c "create database $DB_NAME"
  rm -rf "$STACK/storage" && mkdir -p "$STACK/storage"
}

bootstrap_db() {
  $PSQL -d "$DB_NAME" -f "$ROOT/scripts/local-supabase/bootstrap.sql"
  $PSQL -d "$DB_NAME" -c "grant create on database $DB_NAME to supabase_auth_admin"
  echo "→ GoTrue migrations"
  (cd "$BIN" && auth_env && "$BIN/auth" migrate >"$LOGS/auth-migrate.log" 2>&1) || { cat "$LOGS/auth-migrate.log"; exit 1; }
  $PSQL -d "$DB_NAME" -f "$ROOT/scripts/local-supabase/post-auth.sql"
}

apply_migrations() {
  echo "→ app migrations"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    version="${base%%_*}"
    applied=$($PSQL -d "$DB_NAME" -tAc "select 1 from supabase_migrations.schema_migrations where version='$version'")
    if [ "$applied" != "1" ]; then
      echo "   $base"
      $PSQL -d "$DB_NAME" -1 -f "$f"
      $PSQL -d "$DB_NAME" -c "insert into supabase_migrations.schema_migrations(version, name) values ('$version', '$base')"
    fi
  done
  $PSQL -d "$DB_NAME" -f "$ROOT/scripts/local-supabase/realtime-local.sql" >/dev/null
  $PSQL -d "$DB_NAME" -c "notify pgrst, 'reload schema'" >/dev/null
}

auth_env() {
  export GOTRUE_DB_DRIVER=postgres
  export DATABASE_URL="postgres://supabase_auth_admin:postgres@$PGHOST:$PGPORT/$DB_NAME?search_path=auth&sslmode=disable"
  export GOTRUE_API_HOST=127.0.0.1
  export PORT=$AUTH_PORT
  export API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1"
  export GOTRUE_SITE_URL="${SITE_URL:-http://localhost:3000}"
  export GOTRUE_JWT_SECRET="$JWT_SECRET"
  export GOTRUE_JWT_EXP=3600
  export GOTRUE_JWT_AUD=authenticated
  export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
  export GOTRUE_JWT_ADMIN_ROLES=service_role
  export GOTRUE_DISABLE_SIGNUP=true
  export GOTRUE_EXTERNAL_EMAIL_ENABLED=true
  export GOTRUE_MAILER_AUTOCONFIRM=true
  export GOTRUE_PASSWORD_MIN_LENGTH=8
  export GOTRUE_RATE_LIMIT_TOKEN_REFRESH=100000
  export GOTRUE_RATE_LIMIT_VERIFY=100000
  export GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true
  export GOTRUE_LOG_LEVEL=warn
}

start_services() {
  echo "→ starting GoTrue :$AUTH_PORT"
  (auth_env && cd "$BIN" && setsid nohup "$BIN/auth" serve >"$LOGS/auth.log" 2>&1 </dev/null & echo $! >"$STACK/auth.pid")
  echo "→ starting PostgREST :$PGRST_PORT"
  cat >"$STACK/postgrest.conf" <<EOF
db-uri = "postgres://authenticator:postgres@$PGHOST:$PGPORT/$DB_NAME"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
db-max-rows = 5000
EOF
  (setsid nohup "$BIN/postgrest" "$STACK/postgrest.conf" >"$LOGS/postgrest.log" 2>&1 </dev/null & echo $! >"$STACK/postgrest.pid")
  echo "→ starting gateway :$GATEWAY_PORT"
  (AUTH_UPSTREAM="http://127.0.0.1:$AUTH_PORT" REST_UPSTREAM="http://127.0.0.1:$PGRST_PORT" LOCAL_JWT_SECRET="$JWT_SECRET" LOCAL_DB_URL="postgres://postgres:$PGPASSWORD@$PGHOST:$PGPORT/$DB_NAME" STORAGE_DIR="$STACK/storage" \
    setsid nohup node "$ROOT/scripts/local-supabase/gateway.mjs" >"$LOGS/gateway.log" 2>&1 </dev/null & echo $! >"$STACK/gateway.pid")
  for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:$GATEWAY_PORT/auth/v1/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:$GATEWAY_PORT/rest/v1/ >/dev/null 2>&1; then
      echo "✓ local supabase is up at http://127.0.0.1:$GATEWAY_PORT (db $DB_NAME)"
      return 0
    fi
    sleep 0.5
  done
  echo "✗ services did not become healthy; see $LOGS"; tail -20 "$LOGS"/*.log; exit 1
}

write_env() {
  node "$ROOT/scripts/local-supabase/write-env.mjs" "$JWT_SECRET"
}

download
stop_services
ensure_postgres
exists=$($PSQL -d postgres -tAc "select 1 from pg_database where datname='$DB_NAME'")
if [ "${1:-}" = "--reset" ] || [ "$exists" != "1" ]; then
  reset_db
  bootstrap_db
fi
apply_migrations
write_env
start_services
