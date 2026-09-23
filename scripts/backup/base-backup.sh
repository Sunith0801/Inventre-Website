#!/bin/bash
# Daily physical base backup (tar.gz per tablespace) — with the WAL archive this
# restores to any second. Keeps 30 days locally; the sync mirrors that.
set -euo pipefail; . "$(dirname "$0")/lib.sh"
STAMP="$(date +%Y%m%d_%H%M%S)"; OUT="$ARCHIVE/base/$STAMP"; mkdir -p "$OUT"
log "base backup → $OUT"
docker run --rm --network inventre-deploy_default -v "$OUT":/out -e PGPASSWORD="$POSTGRES_PASSWORD" postgres:16-alpine \
  pg_basebackup -h postgres -U inventre -D /out -Ft -z -X none -c fast --label "inventre-$STAMP" --no-password
[ -s "$OUT/base.tar.gz" ] || { rm -rf "$OUT"; log "FAILED: empty base backup"; mail_alert "base backup FAILED" "pg_basebackup produced no file at $OUT"; exit 1; }
find "$ARCHIVE/base" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
# WAL older than the oldest kept base backup is useless — prune to 31 days.
find "$ARCHIVE/wal" -type f -mtime +31 -delete
log "done ($(du -sh "$OUT" | cut -f1))"
