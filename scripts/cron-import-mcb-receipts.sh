#!/usr/bin/env bash
# Nightly MyClassBoard *receipt* import (mcb_fee_transactions).
#
# Runs after cron-import-mcb.sh, which refreshes the receivables this job
# derives its work-list from — a student whose receivables moved is exactly
# the student whose receipts need re-fetching, and the importer keys off
# that. Incremental by default: only (student × year) pairs never fetched,
# previously failed, re-synced since, or older than --stale-days.
#
# A cold backfill is ~23k MCB calls and runs for hours; do that by hand with
#   scripts/import-mcb-receipts.ts --full --concurrency=10
# and let this nightly tick keep it current afterwards.
#
# Log: /var/log/inventre-import-mcb-receipts.log
set -uo pipefail

APP_DIR=/root/Inventre
LOG=/var/log/inventre-import-mcb-receipts.log
LOCK=/tmp/inventre-import-mcb-receipts.lock

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
  "$APP_DIR/node_modules/.bin/tsx" "$APP_DIR/scripts/import-mcb-receipts.ts"
  echo "exit=$? $(date -Is)"
} 9>"$LOCK" >>"$LOG" 2>&1
