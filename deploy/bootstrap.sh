#!/usr/bin/env bash
# Inventre — one-shot bootstrap for a fresh Contabo Ubuntu VPS.
#
# Usage on the VPS as root:
#   curl -fsSL https://raw.githubusercontent.com/mahendrateja95/Inventre/main/deploy/bootstrap.sh | bash
# Or copy this file up and run:
#   bash deploy/bootstrap.sh
#
# What it does:
#   1. Installs Node 20, Postgres 16, Redis, Nginx, PM2, certbot.
#   2. Creates the inventre Postgres role + database.
#   3. Clones the repo to /opt/inventre.
#   4. Stops here so you can fill in /opt/inventre/.env.local before continuing.
#
# After running this, copy your .env.local up to /opt/inventre/.env.local,
# then run deploy/release.sh to build and start.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mahendrateja95/Inventre.git}"
APP_DIR="/opt/inventre"
DB_NAME="inventre"
DB_USER="inventre"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (use sudo)." >&2
  exit 1
fi

echo "=== 1/6 apt update + base packages ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git build-essential ca-certificates gnupg lsb-release ufw

echo "=== 2/6 Node 20 ==="
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v20" && "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2 tsx

echo "=== 3/6 Postgres 16 + Redis ==="
apt-get install -y postgresql postgresql-contrib redis-server
systemctl enable --now postgresql redis-server

# Create role + DB if missing.
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

echo "=== 4/6 Nginx + certbot ==="
apt-get install -y nginx certbot python3-certbot-nginx

echo "=== 5/6 Firewall ==="
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
yes | ufw enable >/dev/null || true

echo "=== 6/6 Clone repo ==="
if [[ ! -d "${APP_DIR}" ]]; then
  git clone "${REPO_URL}" "${APP_DIR}"
else
  cd "${APP_DIR}" && git pull
fi

cat <<EOF

──────────────────────────────────────────────────────────
 Bootstrap complete.

 Database created:
   DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}

 Next steps:
   1. Copy your .env.local to ${APP_DIR}/.env.local on this server.
      Use the DATABASE_URL above. Set REDIS_URL=redis://127.0.0.1:6379.
   2. Edit /etc/nginx/sites-available/inventre using deploy/nginx.conf
      as a template. Symlink it into sites-enabled and reload nginx.
   3. Run:    bash ${APP_DIR}/deploy/release.sh
   4. SSL:    certbot --nginx -d yourdomain.com -d www.yourdomain.com
──────────────────────────────────────────────────────────
EOF
