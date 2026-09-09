#!/usr/bin/env bash
# Nightly MyClassBoard fee + student import. Invoked by root crontab.
# Sources MCB_* secrets from .env.deploy, points DATABASE_URL at the
# host-exposed Postgres DSN, runs the tsx importer, appends a timestamped
# log. A flock lock prevents overlapping runs.
set -uo pipefail

APP_DIR=/root/Inventre
LOG=/var/log/inventre-import-mcb.log
LOCK=/tmp/inventre-import-mcb.lock

cd "$APP_DIR" || exit 1

set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env.deploy"
set +a

export DATABASE_URL="postgres://inventre:inventre_prod@localhost:55433/inventre"
export DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre"

{
  echo "===== $(date -Is) cron tick ====="
  flock -n 9 || { echo "previous run still active — skipping"; exit 0; }
  # --prune: MCB stops returning a cancelled or re-issued bill, and an upsert
  # cannot notice that. Safe here ONLY because MCB_FEE_WINDOW_DAYS now spans
  # the whole academic year; with a narrow window it would delete the year.
  "$APP_DIR/node_modules/.bin/tsx" "$APP_DIR/scripts/import-from-mcb.ts" --prune
  echo "exit=$? $(date -Is)"
} 9>"$LOCK" >>"$LOG" 2>&1
