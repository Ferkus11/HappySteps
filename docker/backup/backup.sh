#!/bin/sh
# Happy Steps — nightly backup of self-hosted Supabase (docs/self-hosting.md, «Резервные копии»).
#   - database: schemas public, auth, storage, supabase_migrations (pg_dump custom format)
#   - realtime publication membership (not part of a per-schema dump)
#   - Storage files: the file backend directory of the official compose (volumes/storage)
# Usage (as root, from cron):  /opt/happy-steps/docker/backup/backup.sh
# Env: SUPABASE_DIR (default /opt/supabase), BACKUP_DIR (default /var/backups/happy-steps),
#      DB_CONTAINER (default supabase-db), KEEP_DAYS (default 14).
#      DB_URL — dump another database instead (e.g. Supabase Cloud when moving to your server; pg_dump still runs
#      inside DB_CONTAINER). Storage files are then not archived — copy them with `npm run storage:copy`.
set -eu
SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/happy-steps}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP=$(date -u +%Y-%m-%dT%H%MZ)
OUT="$BACKUP_DIR/$STAMP"
umask 077
mkdir -p "$OUT"

# GoTrue/Storage keep their own migration bookkeeping; a fresh stack recreates it, so it is not restored.
if [ -n "${DB_URL:-}" ]; then CONN="$DB_URL"; USER_ARG=""; else CONN="postgres"; USER_ARG="-U supabase_admin"; fi

# shellcheck disable=SC2086
docker exec "$DB_CONTAINER" pg_dump $USER_ARG -d "$CONN" -Fc \
  --schema=public --schema=auth --schema=storage --schema=supabase_migrations \
  --exclude-table=auth.schema_migrations --exclude-table=storage.migrations > "$OUT/db.dump"

# shellcheck disable=SC2086
docker exec "$DB_CONTAINER" psql $USER_ARG -d "$CONN" -Atc \
  "select format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename)
     from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'" > "$OUT/realtime.sql"

if [ -z "${DB_URL:-}" ] && [ -d "$SUPABASE_DIR/volumes/storage" ]; then
  tar -C "$SUPABASE_DIR/volumes" -czf "$OUT/storage.tar.gz" storage
fi

# A dump smaller than 10 KB means something went wrong — fail loudly so cron mails/logs it.
[ "$(wc -c < "$OUT/db.dump")" -gt 10240 ] || { echo "backup: db.dump is suspiciously small" >&2; exit 1; }

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "backup ok: $OUT ($(du -sh "$OUT" | cut -f1))"
