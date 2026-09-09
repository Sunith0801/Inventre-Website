#!/bin/bash
# sync-staging.sh — pull prod code + DB into the staging instance.
# Called by POST /api/admin/sync-staging (Bearer auth).
# Env vars injected by that route:
#   PROD_DB_URL   — prod Postgres direct URL (no pgbouncer)
#   STAGING_DB_URL — staging Postgres URL (inventre_staging on :6533)
set -euo pipefail

LOCK=/tmp/sync-staging.lock
LOG=/tmp/sync-staging.log
STAGING_DIR=/root/Inventre-staging
STAGING_PM2=inventre-testing
STAGING_DIST_DIR=.next-staging

# ── Lock ────────────────────────────────────────────────────────────
if [ -f "$LOCK" ]; then
  LOCKED_PID=$(cat "$LOCK")
  if kill -0 "$LOCKED_PID" 2>/dev/null; then
    echo "LOCK: sync already running (PID $LOCKED_PID)" >&2
    exit 1
  fi
  rm -f "$LOCK"
fi
echo $$ > "$LOCK"
cleanup() { rm -f "$LOCK"; }
trap cleanup EXIT

# Truncate log and start fresh
: > "$LOG"
exec >> "$LOG" 2>&1

echo "=== sync-staging started at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# ── 1. Code ─────────────────────────────────────────────────────────
echo "[1/4] Pulling code from origin/main..."
git -C "$STAGING_DIR" fetch origin
git -C "$STAGING_DIR" reset --hard origin/main
echo "  HEAD: $(git -C "$STAGING_DIR" rev-parse --short HEAD)"

# ── 2. DB ────────────────────────────────────────────────────────────
echo "[2/4] Syncing database (prod → staging)..."
if [ -z "${PROD_DB_URL:-}" ]; then
  echo "  ERROR: PROD_DB_URL not set — skipping DB sync"
else
  # Drop/recreate cleanly to avoid schema conflicts
  # Extract host/port/user/pass/dbname from STAGING_DB_URL
  PG_HOST=localhost
  PG_PORT=6533
  PG_USER=inventre
  PG_PASS=inventre_dev

  PGPASSWORD="$PG_PASS" dropdb  --if-exists -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" inventre_staging
  PGPASSWORD="$PG_PASS" createdb            -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" inventre_staging
  pg_dump --no-owner --no-privileges "$PROD_DB_URL" \
    | PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d inventre_staging -q
  echo "  DB restore complete"
fi

# ── 3. Install + Build ───────────────────────────────────────────────
echo "[3/4] Installing deps + building..."
cd "$STAGING_DIR"
pnpm install --frozen-lockfile --silent
NEXT_DIST_DIR="$STAGING_DIST_DIR" pnpm build
echo "  Build complete"

# ── 4. Restart ───────────────────────────────────────────────────────
echo "[4/4] Restarting pm2 process '$STAGING_PM2'..."
pm2 restart "$STAGING_PM2"
echo "  Restarted"

echo "=== sync-staging finished at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
