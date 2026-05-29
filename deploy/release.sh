#!/usr/bin/env bash
# Inventre — build + restart on the VPS. Run after bootstrap.sh and
# after .env.local is in place at /opt/inventre/.env.local.
#
# Re-run this on every deploy (or use it as the body of a GitHub
# Actions workflow that ssh-es in).

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/inventre}"
cd "${APP_DIR}"

echo "=== git pull ==="
git fetch origin main
git reset --hard origin/main

echo "=== install deps ==="
npm ci --no-audit --no-fund

echo "=== apply schema ==="
# Drizzle pushes the full schema. Idempotent.
npx drizzle-kit push --force
# ERPNext-inspired modules (suppliers, POs, payments, activity log).
npx tsx scripts/apply-erp-migration.ts || true

echo "=== build ==="
npm run build

echo "=== start (PM2) ==="
if pm2 describe inventre >/dev/null 2>&1; then
  pm2 reload inventre --update-env
else
  pm2 start npm --name inventre --time -- start
  pm2 save
  pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null || true
fi

pm2 status
echo "Done. App on http://127.0.0.1:3000"
