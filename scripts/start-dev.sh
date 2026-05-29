#!/bin/sh
# Dev-mode container entrypoint: apply migrations, start Next.js dev server,
# then pre-warm the most-visited routes in the background so users never see
# the slow first-compile delay (Turbopack compiles on first request in dev).
set -e

if [ "${RUN_MIGRATIONS_ON_START:-1}" = "1" ]; then
  echo "[start-dev] running migrations…"
  /app/node_modules/.bin/tsx /app/db/migrate.ts || {
    rc=$?
    echo "[start-dev] migrate.ts exited $rc"
    if [ "${MIGRATIONS_REQUIRED:-1}" = "1" ]; then
      exit $rc
    fi
    echo "[start-dev] continuing despite migration failure (MIGRATIONS_REQUIRED=0)"
  }
else
  echo "[start-dev] skipping migrations (RUN_MIGRATIONS_ON_START=0)"
fi

# Pre-warm key routes after server is ready so users don't see slow first loads.
# Runs in background — server starts immediately, warmup happens in parallel.
(
  BASE="http://localhost:3000"
  # Wait for the server to accept connections (up to 60 s)
  i=0
  while [ $i -lt 30 ]; do
    if wget -q -O /dev/null "$BASE/" 2>/dev/null; then break; fi
    sleep 2
    i=$((i + 1))
  done
  echo "[warmup] server ready — pre-compiling routes…"
  # Hit each important route once; errors are ignored (not logged)
  for path in "/" "/login" "/shop" "/shop/cart" \
              "/api/auth/me" "/api/shop/products" \
              "/admin" "/admin/products" "/admin/students" \
              "/admin/customers" "/admin/orders" "/admin/schools"; do
    wget -q -O /dev/null "$BASE$path" 2>/dev/null &
  done
  wait
  echo "[warmup] route pre-compilation done"
) &

echo "[start-dev] launching Next.js dev server…"
exec /app/node_modules/.bin/next dev --turbopack
