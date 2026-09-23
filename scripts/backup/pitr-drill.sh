#!/bin/bash
# DR-BCP drill D-02: prove point-in-time recovery works, on THIS host, without
# touching production. Takes the newest local base backup + the WAL archive
# (/root/backups-archive, the same files mirrored to Microsoft 365), replays
# them into a THROWAWAY volume/container to a target time, reports table and
# row counts and the newest order, then removes the container.
#
#   bash scripts/backup/pitr-drill.sh ["YYYY-MM-DD HH:MM:SS"]   # default: 10 min ago
#
# Exercises exactly the recovery mechanics of restore-from-m365.sh restore-pitr
# (same tar layout, restore_command, recovery_target_time, promote), but the
# volume is `inventre-pitr-drill`, never `inventre-deploy_pgdata`.
set -euo pipefail; . "$(dirname "$0")/lib.sh"
TARGET_TIME="${1:-$(date -d '10 minutes ago' '+%Y-%m-%d %H:%M:%S %z')}"
VOL=inventre-pitr-drill; CT=inventre-pitr-drill; WORK=/root/restore-drill
BASE_DIR="$(ls -1d "$ARCHIVE"/base/*/ 2>/dev/null | sort | tail -1)"
[ -f "${BASE_DIR}base.tar.gz" ] || { echo "✖ no base backup under $ARCHIVE/base"; exit 1; }
PW="$(grep -E '^POSTGRES_PASSWORD=' "$ROOT/.env.deploy" | head -1 | cut -d= -f2- | tr -d '"')"
START=$(date +%s)
log "PITR drill: base $(basename "$BASE_DIR") + WAL → target $TARGET_TIME (volume $VOL)"
rm -rf "$WORK/wal-plain"; mkdir -p "$WORK/wal-plain"
n=0; for f in "$ARCHIVE"/wal/*.gz "$ARCHIVE"/wal/*.gz.partial; do [ -f "$f" ] || continue; out="$(basename "$f")"; out="${out%.partial}"; out="${out%.gz}"; gunzip -c "$f" > "$WORK/wal-plain/$out" 2>/dev/null || true; n=$((n+1)); done
# The segment still being streamed (.partial) is shorter than 16 MB and Postgres
# refuses it ("has wrong size") — which aborts the WHOLE recovery instead of
# stopping at the last complete record. Zero-padding to 16 MB is the standard
# fix: the zeros read as end-of-WAL. (Found by the first drill, 2026-09-24.)
for f in "$WORK"/wal-plain/*; do [ -f "$f" ] && [ "$(stat -c %s "$f")" -lt 16777216 ] && truncate -s 16777216 "$f"; done
log "unpacked $n WAL segments (partial segment zero-padded)"
docker rm -f "$CT" >/dev/null 2>&1 || true; docker volume rm -f "$VOL" >/dev/null 2>&1 || true; docker volume create "$VOL" >/dev/null
docker run --rm -v "$VOL":/data -v "$BASE_DIR":/base:ro -e TT="$TARGET_TIME" alpine sh -c '
  set -e; cd /data && tar -xzf /base/base.tar.gz
  rm -rf /data/pg_wal && mkdir -p /data/pg_wal
  echo "restore_command = '"'"'cp /walarchive/%f %p'"'"'" >> /data/postgresql.auto.conf
  echo "recovery_target_time = '"'"'$TT'"'"'" >> /data/postgresql.auto.conf
  echo "recovery_target_action = '"'"'promote'"'"'" >> /data/postgresql.auto.conf
  touch /data/recovery.signal; chown -R 70:70 /data'
docker run -d --name "$CT" -v "$VOL":/var/lib/postgresql/data -v "$WORK/wal-plain":/walarchive:ro -e POSTGRES_PASSWORD="$PW" postgres:16-alpine >/dev/null
ok=0
for _ in $(seq 1 240); do
  if docker exec "$CT" pg_isready -U inventre -q 2>/dev/null && [ "$(docker exec "$CT" psql -U inventre -d inventre -Atc 'select pg_is_in_recovery()' 2>/dev/null)" = "f" ]; then ok=1; break; fi
  [ "$(docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null)" = "true" ] || { log "container exited during recovery"; break; }
  sleep 5
done
SECS=$(( $(date +%s) - START ))
if [ "$ok" = 1 ]; then
  REPORT="$(docker exec "$CT" psql -U inventre -d inventre -Atc "select 'tables='||(select count(*) from information_schema.tables where table_schema='public')||' orders='||(select count(*) from orders)||' students='||(select count(*) from students)||' newest_order='||coalesce((select max(placed_at)::text from orders),'-')||' newest_activity='||coalesce((select max(created_at)::text from activity_log),'-')")"
  log "PITR drill OK in ${SECS}s → $REPORT"
  echo "$(date -Is) OK ${SECS}s target=$TARGET_TIME base=$(basename "$BASE_DIR") wal=$n $REPORT" >> "$ARCHIVE/pitr-drill.log"
else
  log "PITR drill FAILED (not promoted within 20 min)"; docker logs --tail 40 "$CT" || true
  echo "$(date -Is) FAILED target=$TARGET_TIME" >> "$ARCHIVE/pitr-drill.log"
fi
docker rm -f "$CT" >/dev/null 2>&1 || true; docker volume rm -f "$VOL" >/dev/null 2>&1 || true; rm -rf "$WORK"
[ "$ok" = 1 ]
