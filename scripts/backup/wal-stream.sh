#!/bin/bash
# Continuous WAL streaming from the production Postgres (point-in-time recovery).
# Runs as the systemd service inventre-wal-stream; pg_receivewal reconnects on
# its own and systemd restarts it if it dies. Slot `inventre_wal` keeps the
# server from recycling WAL we have not received yet — so if this service is
# stopped for long, the server's disk grows; the sync job alerts on that.
set -euo pipefail; . "$(dirname "$0")/lib.sh"
docker rm -f inventre-wal-stream >/dev/null 2>&1 || true
exec docker run --rm --name inventre-wal-stream --network inventre-deploy_default \
  -v "$ARCHIVE/wal":/wal -e PGPASSWORD="$POSTGRES_PASSWORD" postgres:16-alpine \
  pg_receivewal -h postgres -U inventre -D /wal --slot inventre_wal --create-slot --if-not-exists --compress=gzip:6 --verbose
