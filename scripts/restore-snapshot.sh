#!/usr/bin/env bash
# Restore an inventre-snapshot-*.tar.gz on a target server.
# Run from inside the freshly-cloned repo so deploy/up.sh and Dockerfile
# are alongside.
#
# Usage:
#   SNAPSHOT_PASSPHRASE='…' ./scripts/restore-snapshot.sh path/to/snap.tar.gz
#
# Assumes: docker, docker compose v2, git, gpg, postgres-client-16.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: SNAPSHOT_PASSPHRASE='…' $0 <snapshot.tar.gz>" >&2
  exit 1
fi
if [[ -z "${SNAPSHOT_PASSPHRASE:-}" ]]; then
  echo "✗ SNAPSHOT_PASSPHRASE required (same as snapshot time)" >&2
  exit 1
fi

TARBALL="$(realpath "$1")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "==> 1/6  extract"
tar -C "${WORK}" -xzf "${TARBALL}"
DIR="$(find "${WORK}" -maxdepth 1 -type d -name 'inventre-snapshot-*' | head -1)"
[[ -d "${DIR}" ]] || { echo "✗ tarball does not contain inventre-snapshot-* dir" >&2; exit 1; }

echo "==> 2/6  verify manifest"
[[ -f "${DIR}/MANIFEST.json" ]] || { echo "✗ MANIFEST.json missing" >&2; exit 1; }
COMMIT="$(jq -r .git.commit "${DIR}/MANIFEST.json")"
echo "    snapshot commit: ${COMMIT}"
CURRENT="$(git rev-parse HEAD)"
if [[ "${COMMIT}" != "${CURRENT}" ]]; then
  echo "    ! current repo at ${CURRENT}, snapshot expects ${COMMIT}"
  echo "    → checking out ${COMMIT}"
  git fetch --all
  git checkout "${COMMIT}"
fi
# verify file hashes
for k in "db/inventre.dump" "env/env.deploy.gpg" "minio/data.tar.gz"; do
  want="$(jq -r ".files[\"${k}\"].sha256" "${DIR}/MANIFEST.json")"
  [[ "${want}" == "null" || -z "${want}" ]] && continue
  if [[ -f "${DIR}/${k}" ]]; then
    got="$(sha256sum "${DIR}/${k}" | awk '{print $1}')"
    [[ "${want}" == "${got}" ]] || { echo "✗ ${k} hash mismatch" >&2; exit 1; }
  fi
done
echo "    file hashes ok"

echo "==> 3/6  decrypt env"
gpg --batch --yes --pinentry-mode loopback \
    --passphrase "${SNAPSHOT_PASSPHRASE}" \
    --decrypt --output .env.deploy \
    "${DIR}/env/env.deploy.gpg"
chmod 600 .env.deploy

echo "==> 4/6  bring up infra (postgres+pgbouncer+redis+minio)"
docker compose -f docker-compose.deploy.yml -p inventre-deploy \
  --env-file .env.deploy up -d postgres pgbouncer redis minio
# wait for postgres
for i in {1..30}; do
  if docker exec inventre-deploy-postgres pg_isready -U inventre >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "==> 5/6  pg_restore + minio volume restore"
# Drop+recreate to guarantee parity, then restore.
docker exec inventre-deploy-postgres \
  psql -U inventre -d postgres -c \
  "DROP DATABASE IF EXISTS inventre WITH (FORCE); CREATE DATABASE inventre OWNER inventre;"
docker cp "${DIR}/db/inventre.dump" inventre-deploy-postgres:/tmp/inventre.dump
docker exec inventre-deploy-postgres \
  pg_restore -U inventre -d inventre --no-owner --clean --if-exists /tmp/inventre.dump
if [[ -s "${DIR}/minio/data.tar.gz" ]]; then
  docker run --rm \
    -v inventre-deploy_miniodata:/data \
    -v "${DIR}/minio":/in alpine:3 \
    sh -c 'cd /data && tar -xzf /in/data.tar.gz'
fi

echo "==> 6/6  build + start app"
docker compose -f docker-compose.deploy.yml -p inventre-deploy \
  --env-file .env.deploy up -d --build app

echo
echo "✓ restored from $(basename "${TARBALL}")"
echo "  commit: ${COMMIT}"
echo "  next: point nginx + DNS at this host"
