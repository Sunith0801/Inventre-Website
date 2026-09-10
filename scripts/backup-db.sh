#!/bin/bash
#
# Nightly production database backup.
#
# WHY THIS EXISTS. On 2026-09-10 the most recent dump in db_backups/ was dated
# 23 June — 79 days old. A 2.8 GB database carrying 31k orders and 24k students
# was one disk failure away from losing a quarter of a year. This runs from
# cron at 02:15 IST so that stops being true.
#
# WHAT IT GUARANTEES. A dump that cannot be listed by pg_restore is DELETED
# rather than kept, because a corrupt file that looks like a backup is worse
# than no file at all — it is the one you discover is empty on the day you
# need it. The script exits non-zero on any failure so cron reports it.
#
# RETENTION. 14 daily copies, plus the first backup of each month kept
# indefinitely. At ~210 MB a dump that is roughly 3 GB rolling + 2.5 GB a year.
#
# RESTORE (into a scratch database — never straight over production):
#   docker exec -i <db-container> psql -U inventre -d postgres \
#     -c 'create database restore_check'
#   docker exec -i <db-container> pg_restore -U inventre -d restore_check \
#     --no-owner --no-acl < db_backups/daily/inventre_YYYYMMDD_HHMMSS.dump
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DAILY_DIR="$ROOT/db_backups/daily"
MONTHLY_DIR="$ROOT/db_backups/monthly"
LOG="$ROOT/db_backups/backup.log"
LOCK="/tmp/inventre-db-backup.lock"
KEEP_DAILY_DAYS=14
DB_USER="inventre"
DB_NAME="inventre"

mkdir -p "$DAILY_DIR" "$MONTHLY_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') | $*" >> "$LOG"; }
fail() { log "FAILED: $*"; exit 1; }

# One at a time. A second run while a 2.8 GB dump is in flight would compete
# for the same disk and the same connection slot.
exec 9>"$LOCK"
flock -n 9 || { log "SKIPPED: another backup is already running"; exit 0; }

# Resolve the container by name FILTER, not a literal. The production DB
# container is currently named `1c61220878ef_inventre-deploy-postgres` — the
# hash prefix comes from a docker-compose recreate and will change the next
# time that happens. A hardcoded name would silently stop backing up.
CONTAINER="$(docker ps --filter "name=inventre-deploy-postgres" --format '{{.Names}}' | head -1)"
[ -n "$CONTAINER" ] || fail "no running container matching inventre-deploy-postgres"

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$DAILY_DIR/inventre_${STAMP}.dump"

log "starting dump from $CONTAINER"
if ! docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc --no-owner --no-acl "$DB_NAME" > "$OUT" 2>>"$LOG"; then
  rm -f "$OUT"
  fail "pg_dump returned non-zero (partial file removed)"
fi

SIZE_BYTES="$(stat -c%s "$OUT" 2>/dev/null || echo 0)"
if [ "$SIZE_BYTES" -lt 10000000 ]; then          # under 10 MB is not this database
  rm -f "$OUT"
  fail "dump is only $SIZE_BYTES bytes — too small to be real (removed)"
fi

# The check that matters: can it actually be read back? A truncated dump still
# has a plausible size.
OBJECTS="$(pg_restore --list "$OUT" 2>/dev/null | grep -c '^[0-9]' || echo 0)"
if [ "$OBJECTS" -lt 100 ]; then
  rm -f "$OUT"
  fail "dump lists only $OBJECTS objects — not a valid archive (removed)"
fi

SIZE_H="$(du -h "$OUT" | cut -f1)"
log "OK: $(basename "$OUT") — $SIZE_H, $OBJECTS objects"

# First backup of the month is kept forever. Hardlink, so it costs no extra
# disk until the daily copy is rotated away.
MONTH_TAG="$(date +%Y%m)"
if ! ls "$MONTHLY_DIR"/inventre_${MONTH_TAG}*.dump >/dev/null 2>&1; then
  ln "$OUT" "$MONTHLY_DIR/inventre_${STAMP}.dump" 2>/dev/null \
    && log "kept as the $MONTH_TAG monthly copy"
fi

DELETED="$(find "$DAILY_DIR" -name 'inventre_*.dump' -type f -mtime +$KEEP_DAILY_DAYS -print -delete | wc -l)"
[ "$DELETED" -gt 0 ] && log "rotated out $DELETED daily backup(s) older than $KEEP_DAILY_DAYS days"

log "done — $(ls -1 "$DAILY_DIR" | wc -l) daily, $(ls -1 "$MONTHLY_DIR" | wc -l) monthly on disk"
exit 0
