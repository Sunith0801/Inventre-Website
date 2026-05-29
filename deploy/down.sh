#!/usr/bin/env bash
# Bring the Inventre deploy stack down. Data persists in named volumes
# (pgdata, redisdata, miniodata). Pass --volumes to also drop those.
set -euo pipefail

cd "$(dirname "$0")/.."

exec docker-compose \
  -f docker-compose.deploy.yml \
  -p inventre-deploy \
  down "$@"
