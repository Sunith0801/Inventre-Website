#!/bin/bash
# Mirror every backup artefact to the company's Microsoft 365 (SharePoint
# library) every 5 minutes. Sources → destination folders:
#   /root/backups-archive/{wal,base,code,config} → <site>/Documents/Inventre Backups/prod/{…}  (encrypted, rclone crypt)
#   code/ holds git bundles (every commit, via the post-commit hook) + uncommitted-latest.* when the tree is dirty
#   config/env.deploy.gpg = .env.deploy, AES-256 (SNAPSHOT_PASSPHRASE), refreshed on change
#   /root/Inventre/db_backups/{daily,monthly} → Backups/prod/dumps/{daily,monthly}
#   /root/Inventre/backups/*.tar.gz (6-hourly encrypted snapshots) → Backups/prod/snapshots
# `sync` mirrors local retention; nothing is deleted remotely that still exists locally.
set -uo pipefail; . "$(dirname "$0")/lib.sh"
exec 9>/tmp/inventre-m365-sync.lock; flock -n 9 || exit 0
m365_env || { log "M365 not configured"; exit 1; }
# Configuration: .env.deploy, AES-256 with SNAPSHOT_PASSPHRASE, refreshed whenever it changes
# (the 6-hourly snapshot carries it too; this keeps the mirror within 5 minutes of any edit).
mkdir -p "$ARCHIVE/config"
if [ "$(sha256sum "$ROOT/.env.deploy" | cut -c1-64)" != "$(cat "$ARCHIVE/config/.env.sha" 2>/dev/null)" ]; then
  gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --passphrase "$SNAPSHOT_PASSPHRASE" -o "$ARCHIVE/config/env.deploy.gpg" "$ROOT/.env.deploy" \
    && sha256sum "$ROOT/.env.deploy" | cut -c1-64 > "$ARCHIVE/config/.env.sha" && log "config: .env.deploy re-encrypted"
fi
# Code: anything edited but not yet committed (committed work is bundled by the post-commit hook)
if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
  ( cd "$ROOT" && git ls-files -m -o --exclude-standard -z | tar --null -T - -czf "$ARCHIVE/code/uncommitted-latest.tar.gz" 2>/dev/null ) \
    && ( cd "$ROOT" && git diff HEAD > "$ARCHIVE/code/uncommitted-latest.patch" 2>/dev/null; git status --porcelain > "$ARCHIVE/code/uncommitted-latest.txt" ) || true
else
  rm -f "$ARCHIVE/code/uncommitted-latest.tar.gz" "$ARCHIVE/code/uncommitted-latest.patch" "$ARCHIVE/code/uncommitted-latest.txt"
fi
DEST="m365crypt:"; FAIL=0
R="--fast-list --transfers 4 --checkers 8 --retries 3 --low-level-retries 10 --stats 0 -q"
rclone sync $R "$ARCHIVE/wal"  "$DEST/wal"  || FAIL=1
rclone sync $R "$ARCHIVE/base" "$DEST/base" || FAIL=1
rclone sync $R "$ARCHIVE/code" "$DEST/code" || FAIL=1
rclone sync $R --exclude ".env.sha" "$ARCHIVE/config" "$DEST/config" || FAIL=1
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
# self-contained recovery kit (scripts + one-passphrase secret bundle) next to the data
"$ROOT/scripts/backup/publish-recovery-kit.sh" >/dev/null 2>&1 || log "recovery kit publish failed"
[ "$PREV" != "ok" ] && mail_alert "backups healthy again" "Sync to Microsoft 365 succeeded; WAL streaming current."
echo ok > $STATE; log "synced ($(du -sh "$ARCHIVE" | cut -f1) archive)"
