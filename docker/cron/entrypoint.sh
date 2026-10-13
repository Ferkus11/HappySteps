#!/bin/sh
# Cron container: busybox crond from the plain alpine image, no packages installed.
set -eu
if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set — refusing to start" >&2
  exit 1
fi
cp /cron/crontab /etc/crontabs/root
echo "cron: calling ${APP_INTERNAL_URL:-http://app:3000} (schedules in UTC)"
# --once <path>: call a single route and exit (used to check the setup by hand).
if [ "${1:-}" = "--once" ]; then exec sh /cron/call.sh "$2"; fi
exec crond -f -l 8
