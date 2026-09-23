#!/bin/bash
# Rotate the production Postgres password for role `inventre` (F-04).
#
# Run from /root/Inventre as root. Steps, in order, all-or-nothing as far as
# a shell script can be:
#   1. generate a new password
#   2. ALTER ROLE inside the postgres container (needs a live superuser session)
#   3. write POSTGRES_PASSWORD into .env.deploy
#   4. recreate pgbouncer (auth is env-driven) and the app container
#      (DATABASE_URL is interpolated from .env.deploy), then verify /api/health
#
# Other readers of POSTGRES_PASSWORD — deploy.sh, cron-import-mcb*.sh — read
# .env.deploy at run time, so they pick the new value up automatically.
# The previous .env.deploy is copied to /root/.secrets-archive first.
set -euo pipefail
cd "$(dirname "$0")/.."
ENVF=.env.deploy
PG_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'inventre-deploy-postgres$' | head -1)
[ -n "$PG_CONTAINER" ] || { echo "postgres container not found"; exit 1; }
OLD=$(grep -E '^POSTGRES_PASSWORD=' $ENVF | cut -d= -f2- | tr -d '"')
[ -n "$OLD" ] || { echo "POSTGRES_PASSWORD missing from $ENVF"; exit 1; }
NEW=$(openssl rand -hex 24)
ARCH=/root/.secrets-archive; mkdir -p $ARCH; chmod 700 $ARCH
cp -p $ENVF $ARCH/.env.deploy.pre-dbrotate-$(date +%Y%m%d-%H%M%S)
echo "▶ ALTER ROLE inventre (in $PG_CONTAINER)…"
docker exec -e NEWPW="$NEW" "$PG_CONTAINER" sh -c 'psql -U inventre -d inventre -v ON_ERROR_STOP=1 -qc "ALTER ROLE inventre WITH PASSWORD '"'"'$NEWPW'"'"'"'
echo "▶ writing POSTGRES_PASSWORD to $ENVF…"
sed -i -E "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$NEW|" $ENVF
echo "▶ recreating pgbouncer + app with the new password…"
docker compose -p inventre-deploy --env-file $ENVF -f docker-compose.deploy.yml up -d --no-deps --force-recreate pgbouncer
sleep 3
docker compose -p inventre-deploy --env-file $ENVF -f docker-compose.deploy.yml up -d --no-deps --force-recreate app
docker network connect inventre-deploy_default inventre-deploy-app 2>/dev/null || true
echo "▶ the recreated app container serves the IMAGE's build; syncing the current build back in…"
./scripts/deploy.sh --fast --allow-dirty
echo "▶ verifying direct + pooled logins with the new password…"
PGPASSWORD="$NEW" psql -h 127.0.0.1 -p 55433 -U inventre -d inventre -Atc "select 'direct ok'" 2>/dev/null || docker exec -e PGPASSWORD="$NEW" "$PG_CONTAINER" psql -h 127.0.0.1 -U inventre -d inventre -Atc "select 'direct ok'"
docker run --rm --network inventre-deploy_default -e PGPASSWORD="$NEW" postgres:16-alpine psql -h pgbouncer -U inventre -d inventre -Atc "select 'pooled ok'"
echo "▶ old password must now fail:"
docker exec -e PGPASSWORD="$OLD" "$PG_CONTAINER" psql -h 127.0.0.1 -U inventre -d inventre -Atc "select 1" 2>&1 | head -1 || true
curl -s https://inventre.in/api/health; echo
echo "✓ done. Other checkouts' .env.deploy copies (Inventre-dev, Inventre-heal) still hold the OLD password — they point at their own dev databases, so nothing breaks, but update them if any script there targets :55433."
