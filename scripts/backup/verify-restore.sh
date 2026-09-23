#!/bin/bash
# Weekly proof that the backups restore: newest daily dump → throwaway Postgres
# container → count tables and rows → e-mail the result. A backup nobody has
# restored is a hope, not a backup.
set -uo pipefail; . "$(dirname "$0")/lib.sh"
DUMP="$(ls -1t "$ROOT"/db_backups/daily/*.dump 2>/dev/null | head -1)"
[ -n "$DUMP" ] || { mail_alert "restore test FAILED" "no dump found in db_backups/daily"; exit 1; }
docker rm -f inventre-restore-test >/dev/null 2>&1 || true
docker run -d --name inventre-restore-test -e POSTGRES_PASSWORD=restoretest -e POSTGRES_DB=restore postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do docker exec inventre-restore-test pg_isready -U postgres -q && break; sleep 2; done
START=$(date +%s)
docker exec -i inventre-restore-test pg_restore -U postgres -d restore --no-owner --no-acl < "$DUMP" 2>/tmp/inventre-restore-test.err || true
TABLES="$(docker exec inventre-restore-test psql -U postgres -d restore -Atc "select count(*) from information_schema.tables where table_schema='public'")"
ORDERS="$(docker exec inventre-restore-test psql -U postgres -d restore -Atc "select count(*) from orders" 2>/dev/null || echo 0)"
STUDENTS="$(docker exec inventre-restore-test psql -U postgres -d restore -Atc "select count(*) from students" 2>/dev/null || echo 0)"
SECS=$(( $(date +%s) - START ))
docker rm -f inventre-restore-test >/dev/null 2>&1 || true
if [ "${TABLES:-0}" -ge 90 ] && [ "${ORDERS:-0}" -gt 1000 ]; then
  log "restore OK: $TABLES tables, $ORDERS orders, $STUDENTS students in ${SECS}s from $(basename "$DUMP")"
  mail_alert "weekly restore test PASSED" "$(basename "$DUMP") restored in ${SECS}s: $TABLES tables, $ORDERS orders, $STUDENTS students. WAL archive: $(du -sh "$ARCHIVE/wal" | cut -f1); newest base backup: $(ls -1t "$ARCHIVE/base" | head -1)."
else
  log "restore FAILED: tables=$TABLES orders=$ORDERS"; mail_alert "weekly restore test FAILED" "$(basename "$DUMP"): tables=$TABLES orders=$ORDERS. stderr: $(tail -5 /tmp/inventre-restore-test.err)"; exit 1
fi
