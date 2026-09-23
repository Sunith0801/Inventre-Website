#!/bin/bash
# One-off: bring Redis and MinIO back after docker-compose v1 crashed mid-recreate
# (KeyError 'ContainerConfig') during the 2026-09-23 F-04 password rotation.
# Uses the same stop+rm+create path deploy.sh uses for the app container.
set -euo pipefail
cd /root/Inventre
for c in $(docker ps -a --format '{{.Names}}' | grep -E '(^|_)inventre-deploy-(redis|minio|minio-init)$'); do
  docker rm -f "$c" >/dev/null && echo "removed $c"
done
docker-compose -p inventre-deploy --env-file .env.deploy -f docker-compose.deploy.yml up -d --no-deps redis minio minio-init
sleep 6
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'inventre-deploy-(redis|minio|app)'
echo "--- app health:"; curl -s -m 20 https://inventre.in/api/health; echo
echo "--- redis answers with the rotated password:"
docker exec inventre-deploy-redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping; echo -n "keys: "; redis-cli -a "$REDIS_PASSWORD" --no-auth-warning dbsize'
