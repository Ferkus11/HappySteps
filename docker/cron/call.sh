#!/bin/sh
# Calls one cron route of the app with the shared secret and logs one line to the container log.
# Usage: /cron/call.sh /api/cron/<job>     (env: CRON_SECRET, APP_INTERNAL_URL)
path="$1"
url="${APP_INTERNAL_URL:-http://app:3000}${path}"
started=$(date -u +%FT%TZ)
if body=$(wget -q -T 300 -O - --header "Authorization: Bearer ${CRON_SECRET}" "$url" 2>&1); then
  status=ok
else
  status=FAIL
fi
# Never print the secret; trim the body to keep logs short.
body=$(printf '%s' "$body" | tr '\n' ' ' | cut -c1-300)
echo "$started $status $path $body" > /proc/1/fd/1
[ "$status" = ok ]
