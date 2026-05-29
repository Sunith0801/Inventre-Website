#!/usr/bin/env bash
# Bring the Inventre deploy stack up under the unified compose project.
# Always uses -p inventre-deploy and --env-file .env.deploy so all
# services land on a single docker network and pick up AUTH_SECRET / JWT_SECRET.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.deploy ]; then
  echo "missing .env.deploy in $(pwd)" >&2
  exit 1
fi

exec docker-compose \
  -f docker-compose.deploy.yml \
  -p inventre-deploy \
  --env-file .env.deploy \
  up -d "$@"
