#!/usr/bin/env bash
# Cron-friendly wrapper around snapshot-deploy.sh.
# Reads SNAPSHOT_PASSPHRASE + S3_* creds from .env.deploy, then:
#   1. produces a snapshot tarball locally,
#   2. uploads it to Cloudflare R2 bucket inventre-backups,
#   3. prunes local tarballs older than 7 days,
#   4. prunes R2 tarballs older than 30 days.
#
# Exit non-zero on any failure so cron sends mail / logs an error.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

LOG_DIR="/var/log/inventre"
mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_DIR}/snapshot.log") 2>&1
echo
echo "==================== $(date -Iseconds) ===================="

# -------- load env --------
if [[ ! -f .env.deploy ]]; then
  echo "✗ .env.deploy missing" >&2; exit 1
fi
set -a
# shellcheck disable=SC1091
source .env.deploy
set +a

: "${SNAPSHOT_PASSPHRASE:?SNAPSHOT_PASSPHRASE must be set in .env.deploy}"
: "${S3_ENDPOINT:?S3_ENDPOINT must be set in .env.deploy (R2 endpoint)}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID required}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY required}"

BACKUP_BUCKET="${BACKUP_BUCKET:-inventre-backups}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
REMOTE_RETENTION_DAYS="${REMOTE_RETENTION_DAYS:-30}"

# -------- 1. snapshot --------
echo "[1/4] taking snapshot"
SNAPSHOT_PASSPHRASE="${SNAPSHOT_PASSPHRASE}" "${ROOT}/scripts/snapshot-deploy.sh"

# newest tarball in backups/
TAR="$(ls -1t "${ROOT}"/backups/inventre-snapshot-*.tar.gz 2>/dev/null | head -1)"
[[ -f "${TAR}" ]] || { echo "✗ no snapshot tarball found"; exit 1; }
BASENAME="$(basename "${TAR}")"

# -------- 2. upload to R2 (via docker mc) --------
# R2 may not be wired up yet (bucket missing / creds bucket-scoped). Log
# the failure prominently but keep going — local snapshots are the
# primary line of defense and cron should still prune them.
echo "[2/4] uploading ${BASENAME} to r2://${BACKUP_BUCKET}/"
R2_OK=1
docker run --rm \
  -v "${ROOT}/backups":/backups:ro \
  -e MC_HOST_r2="https://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@${S3_ENDPOINT#https://}" \
  --entrypoint sh minio/mc:latest -c "
    mc mb --ignore-existing r2/${BACKUP_BUCKET} > /dev/null 2>&1 || true;
    mc cp /backups/${BASENAME} r2/${BACKUP_BUCKET}/${BASENAME}
  " || R2_OK=0
if [[ "${R2_OK}" != "1" ]]; then
  echo "  ⚠  R2 upload failed — local snapshot kept, off-site copy missing"
  echo "  ⚠  fix: create bucket '${BACKUP_BUCKET}' in Cloudflare R2 +"
  echo "  ⚠         issue an API token with write access to it"
fi

# -------- 3. prune local --------
echo "[3/4] pruning local backups older than ${LOCAL_RETENTION_DAYS}d"
find "${ROOT}/backups" -maxdepth 1 -type f -name 'inventre-snapshot-*.tar.gz' \
  -mtime "+${LOCAL_RETENTION_DAYS}" -print -delete || true

# -------- 4. prune R2 --------
if [[ "${R2_OK}" != "1" ]]; then
  echo "[4/4] skipping R2 prune (upload was not configured)"
  exit 0
fi
echo "[4/4] pruning R2 backups older than ${REMOTE_RETENTION_DAYS}d"
CUTOFF_EPOCH=$(( $(date +%s) - REMOTE_RETENTION_DAYS * 86400 ))
docker run --rm \
  -e MC_HOST_r2="https://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@${S3_ENDPOINT#https://}" \
  -e CUTOFF_EPOCH="${CUTOFF_EPOCH}" \
  -e BACKUP_BUCKET="${BACKUP_BUCKET}" \
  --entrypoint sh minio/mc:latest -c '
    mc ls --json "r2/$BACKUP_BUCKET" 2>/dev/null | while read -r line; do
      key=$(echo "$line" | sed -n "s/.*\"key\":\"\([^\"]*\)\".*/\1/p")
      modtime=$(echo "$line" | sed -n "s/.*\"lastModified\":\"\([^\"]*\)\".*/\1/p")
      [ -z "$key" ] && continue
      [ -z "$modtime" ] && continue
      ts=$(date -d "$modtime" +%s 2>/dev/null) || continue
      if [ "$ts" -lt "$CUTOFF_EPOCH" ]; then
        echo "  pruning r2://$BACKUP_BUCKET/$key (age $(( ( $(date +%s) - ts ) / 86400 ))d)"
        mc rm "r2/$BACKUP_BUCKET/$key" > /dev/null
      fi
    done
  '

echo "✓ snapshot+rotate done: ${BASENAME}"
