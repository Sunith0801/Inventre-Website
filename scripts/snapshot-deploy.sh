#!/usr/bin/env bash
# Produce a single self-describing tarball that another server can use to
# come up byte-for-byte identical (DB rows + storefront + admin + creds).
#
# Layout of the output snapshot:
#   inventre-snapshot-<ts>/
#     MANIFEST.json          schema, git SHA, image tag, file sha256s
#     db/inventre.dump       pg_dump --format=custom (compressed)
#     env/env.deploy.gpg     .env.deploy, AES-256 symmetric
#     minio/data.tar.gz      contents of the miniodata docker volume
#     README.txt             how to restore
#
# Usage:
#   SNAPSHOT_PASSPHRASE='something-strong' ./scripts/snapshot-deploy.sh
#
# Passphrase is required (no default) — without it the snapshot is rejected.
# The same passphrase is needed at restore time. Treat it like a backup key.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

if [[ -z "${SNAPSHOT_PASSPHRASE:-}" ]]; then
  echo "✗ SNAPSHOT_PASSPHRASE must be set (used to encrypt .env.deploy)" >&2
  exit 1
fi
if [[ ! -f .env.deploy ]]; then
  echo "✗ .env.deploy missing — refusing to make a snapshot without it" >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
NAME="inventre-snapshot-${TS}"
OUT="${ROOT}/backups/${NAME}"
mkdir -p "${OUT}/db" "${OUT}/env" "${OUT}/minio"

echo "==> 1/5  pg_dump"
# Use direct postgres port (55433), not pgbouncer, so DDL works.
docker exec 1c61220878ef_inventre-deploy-postgres \
  pg_dump -U inventre -Fc inventre \
  > "${OUT}/db/inventre.dump"
DB_SHA="$(sha256sum "${OUT}/db/inventre.dump" | awk '{print $1}')"
DB_BYTES="$(stat -c%s "${OUT}/db/inventre.dump")"
echo "    db dump ${DB_BYTES} bytes, sha256=${DB_SHA:0:16}…"

echo "==> 2/5  encrypt .env.deploy"
gpg --batch --yes --pinentry-mode loopback \
    --passphrase "${SNAPSHOT_PASSPHRASE}" \
    --symmetric --cipher-algo AES256 \
    --output "${OUT}/env/env.deploy.gpg" \
    .env.deploy
ENV_SHA="$(sha256sum "${OUT}/env/env.deploy.gpg" | awk '{print $1}')"
echo "    env encrypted, sha256=${ENV_SHA:0:16}…"

echo "==> 3/5  minio volume tar"
# Run a throwaway alpine to tar /data from the named volume. Works even
# when the minio container is stopped.
docker run --rm \
  -v inventre-deploy_miniodata:/data:ro \
  -v "${OUT}/minio":/out alpine:3 \
  sh -c 'cd /data && tar -czf /out/data.tar.gz . 2>/dev/null' || true
if [[ -f "${OUT}/minio/data.tar.gz" ]]; then
  MINIO_SHA="$(sha256sum "${OUT}/minio/data.tar.gz" | awk '{print $1}')"
  MINIO_BYTES="$(stat -c%s "${OUT}/minio/data.tar.gz")"
else
  MINIO_SHA=""
  MINIO_BYTES=0
fi
echo "    minio ${MINIO_BYTES} bytes"

echo "==> 4/5  manifest"
GIT_SHA="$(git rev-parse HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
GIT_DIRTY="$(git status --porcelain | wc -l)"
IMAGE_TAG="$(docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
              | awk '$1=="inventre-app:latest"{print $2; exit}')"
cat > "${OUT}/MANIFEST.json" <<JSON
{
  "schema": 1,
  "taken_at": "$(date -Iseconds)",
  "host": "$(hostname)",
  "git": {
    "commit": "${GIT_SHA}",
    "branch": "${GIT_BRANCH}",
    "dirty_files": ${GIT_DIRTY}
  },
  "image": {
    "name": "inventre-app:latest",
    "id": "${IMAGE_TAG}"
  },
  "files": {
    "db/inventre.dump":  { "bytes": ${DB_BYTES},   "sha256": "${DB_SHA}" },
    "env/env.deploy.gpg":{ "bytes": $(stat -c%s "${OUT}/env/env.deploy.gpg"),
                           "sha256": "${ENV_SHA}" },
    "minio/data.tar.gz": { "bytes": ${MINIO_BYTES}, "sha256": "${MINIO_SHA}" }
  },
  "notes": [
    "Storage of frontend images is Cloudflare R2 (external).",
    "Encrypted .env.deploy carries the R2 creds, so the restored deploy",
    "points at the same bucket — no replication needed for asset parity."
  ]
}
JSON

cat > "${OUT}/README.txt" <<'TXT'
This snapshot was produced by scripts/snapshot-deploy.sh.

To restore on a fresh server:
  1. Install Docker + git + gpg + postgres-client-16.
  2. git clone <repo> /opt/inventre && cd /opt/inventre
     git checkout <commit from MANIFEST.json>
  3. Copy this entire directory to /tmp/<NAME>/ on the target.
  4. SNAPSHOT_PASSPHRASE='...' /opt/inventre/scripts/restore-snapshot.sh \
        /tmp/<NAME>
The restore script will:
  - Decrypt env/env.deploy.gpg → /opt/inventre/.env.deploy
  - Bring up postgres+pgbouncer+redis+minio (./deploy/up.sh postgres pgbouncer redis minio)
  - pg_restore db/inventre.dump into the inventre database
  - Untar minio/data.tar.gz into the miniodata volume
  - Build + start the app container (./deploy/up.sh --build app)
After restore, the new host serves identical frontend (R2 assets) and
identical data (DB dump) at the same commit (git checkout).
TXT

echo "==> 5/5  pack tarball"
TAR="${ROOT}/backups/${NAME}.tar.gz"
tar -C "${ROOT}/backups" -czf "${TAR}" "${NAME}"
TAR_SHA="$(sha256sum "${TAR}" | awk '{print $1}')"
TAR_BYTES="$(stat -c%s "${TAR}")"
rm -rf "${OUT}"

echo
echo "✓ snapshot: ${TAR}"
echo "  ${TAR_BYTES} bytes, sha256=${TAR_SHA}"
echo "  restore with: SNAPSHOT_PASSPHRASE='…' scripts/restore-snapshot.sh ${TAR}"
