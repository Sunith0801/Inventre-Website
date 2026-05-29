#!/usr/bin/env bash
# Hourly ERPNext Education sync. Invoked by root crontab.
# Loads ERPNEXT_* secrets from .env.deploy, points DATABASE_URL at the
# direct Postgres DSN (host-exposed port), runs the tsx importer, and
# appends a timestamped log. A lock prevents overlapping runs.
set -uo pipefail

APP_DIR=/root/Inventre
LOG=/var/log/inventre-sync-education.log
LOCK=/tmp/inventre-sync-education.lock

cd "$APP_DIR" || exit 1

# Pull ERPNEXT_BASE / ERPNEXT_TOKEN (and any other) from the deploy env file.
set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env.deploy"
set +a

export DATABASE_URL="postgres://inventre:inventre_prod@localhost:55433/inventre"
export DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre"

{
  echo "===== $(date -Is) cron tick ====="
  # flock: skip this tick if a previous run is still going.
  flock -n 9 || { echo "previous run still active — skipping"; exit 0; }
  # `server-only` throws via its default export; Next picks the no-op
  # `react-server` export condition. Mirror that for the standalone run.
  NODE_OPTIONS="--conditions=react-server" \
    "$APP_DIR/node_modules/.bin/tsx" "$APP_DIR/scripts/sync-education.ts"
  echo "exit=$? $(date -Is)"
} 9>"$LOCK" >>"$LOG" 2>&1
