#!/bin/bash
# Mirror every backup artefact to the company's Microsoft 365 (SharePoint
# library) every 5 minutes. Sources → destination folders:
#   /root/backups-archive/{wal,base,code}  → <site>/Documents/Inventre Backups/prod/{wal,base,code}  (encrypted, rclone crypt)
#   /root/Inventre/db_backups/{daily,monthly} → Backups/prod/dumps/{daily,monthly}
#   /root/Inventre/backups/*.tar.gz (6-hourly encrypted snapshots) → Backups/prod/snapshots
# `sync` mirrors local retention; nothing is deleted remotely that still exists locally.
set -uo pipefail; . "$(dirname "$0")/lib.sh"
exec 9>/tmp/inventre-m365-sync.lock; flock -n 9 || exit 0
m365_env || { log "M365 not configured"; exit 1; }
DEST="m365crypt:"; FAIL=0
R="--fast-list --transfers 4 --checkers 8 --retries 3 --low-level-retries 10 --stats 0 -q"
rclone sync $R "$ARCHIVE/wal"  "$DEST/wal"  || FAIL=1
rclone sync $R "$ARCHIVE/base" "$DEST/base" || FAIL=1
rclone sync $R "$ARCHIVE/code" "$DEST/code" || FAIL=1
rclone sync $R "$ROOT/db_backups/daily"   "$DEST/dumps/daily"   || FAIL=1
rclone sync $R "$ROOT/db_backups/monthly" "$DEST/dumps/monthly" || FAIL=1
rclone sync $R --include 'inventre-snapshot-*.tar.gz' "$ROOT/backups" "$DEST/snapshots" || FAIL=1
STATE=/tmp/inventre-m365-sync.state; PREV="$(cat $STATE 2>/dev/null || echo ok)"
if [ "$FAIL" = 1 ]; then
  log "sync FAILED"; [ "$PREV" != "failed" ] && mail_alert "sync to Microsoft 365 FAILED" "rclone could not mirror the backup tree. See $LOGDIR/m365-sync.log"; echo failed > $STATE; exit 1
fi
# Freshness guard: the newest WAL segment must be under 30 min old while the streamer runs.
NEWEST="$(find "$ARCHIVE/wal" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)"
if [ -n "$NEWEST" ] && [ $(( $(date +%s) - NEWEST )) -gt 1800 ] && ! docker ps --format '{{.Names}}' | grep -q '^inventre-wal-stream$'; then
  [ "$PREV" != "stale" ] && mail_alert "WAL streaming is NOT running" "No WAL received for $(( ( $(date +%s) - NEWEST ) / 60 )) min and the inventre-wal-stream container is down. Start: systemctl start inventre-wal-stream"
  echo stale > $STATE; exit 0
fi
[ "$PREV" != "ok" ] && mail_alert "backups healthy again" "Sync to Microsoft 365 succeeded; WAL streaming current."
echo ok > $STATE; log "synced ($(du -sh "$ARCHIVE" | cut -f1) archive)"
