#!/bin/sh
# Container entrypoint: apply migrations, then start the Next.js server.
# Migrations run with the direct (non-PgBouncer) DSN since DDL needs
# session-pinned connections.
set -e

if [ "${RUN_MIGRATIONS_ON_START:-1}" = "1" ]; then
  echo "[start] running migrations…"
  node /app/db/migrate.js || {
    rc=$?
    echo "[start] migrate.js exited $rc"
    if [ "${MIGRATIONS_REQUIRED:-1}" = "1" ]; then
      exit $rc
    fi
    echo "[start] continuing despite migration failure (MIGRATIONS_REQUIRED=0)"
  }
else
  echo "[start] skipping migrations (RUN_MIGRATIONS_ON_START=0)"
fi

echo "[start] launching Next.js…"
exec node /app/server.js
