#!/bin/sh
# Restores a backup made by backup.sh (also a dump of Supabase Cloud) into a FRESH self-hosted Supabase (empty public schema, no migrations
# applied). Usage:  /opt/happy-steps/docker/backup/restore.sh /var/backups/happy-steps/<stamp>
# Env: SUPABASE_DIR (default /opt/supabase), DB_CONTAINER (default supabase-db).
set -eu
SRC="${1:?usage: restore.sh <backup dir>}"
SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
[ -f "$SRC/db.dump" ] || { echo "no $SRC/db.dump" >&2; exit 1; }

tables=$(docker exec "$DB_CONTAINER" psql -U supabase_admin -d postgres -Atc "select count(*) from pg_tables where schemaname = 'public'")
if [ "$tables" != "0" ]; then
  echo "public schema is not empty ($tables tables) — restore only into a fresh Supabase" >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" sh -c 'cat > /tmp/restore.dump' < "$SRC/db.dump"

# Supabase grants ALL on every new table/function in public to anon/authenticated by default privileges. The dump
# only contains GRANTs, so objects created during the restore would keep those extra rights and lose the column
# and function restrictions of our migrations. Switch the defaults off while restoring and back on afterwards.
sql() { docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
defaults() {
  sql <<SQL
alter default privileges for role supabase_admin in schema public $1 all on tables $2 postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public $1 all on sequences $2 postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public $1 all on functions $2 postgres, anon, authenticated, service_role;
SQL
}
defaults revoke from
trap 'defaults grant to' EXIT
sql -c "create schema if not exists supabase_migrations"
# 1) our tables, functions, policies (+ migration history)  2) all rows; FK checks off while loading
docker exec "$DB_CONTAINER" pg_restore -U supabase_admin -d postgres --single-transaction --exit-on-error \
  --schema-only --schema=public --schema=supabase_migrations /tmp/restore.dump
docker exec "$DB_CONTAINER" pg_restore -U supabase_admin -d postgres --single-transaction --exit-on-error \
  --data-only --disable-triggers --schema=public --schema=supabase_migrations --schema=auth --schema=storage /tmp/restore.dump
# 3) realtime (chats, notifications)
sql < "$SRC/realtime.sql"
docker exec "$DB_CONTAINER" rm -f /tmp/restore.dump

if [ -f "$SRC/storage.tar.gz" ]; then
  tar -C "$SUPABASE_DIR/volumes" -xzf "$SRC/storage.tar.gz"
  echo "storage files restored to $SUPABASE_DIR/volumes/storage"
fi
echo "restore ok — restart the stack: (cd $SUPABASE_DIR && docker compose restart)"
