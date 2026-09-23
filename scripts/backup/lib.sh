#!/bin/bash
# Shared bits for the backup pipeline (F-11, 2026-09-23). Source, don't run.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARCHIVE=/root/backups-archive                 # local staging tree that is mirrored to Microsoft 365
LOGDIR=/var/log/inventre; mkdir -p "$LOGDIR"
set -a; . "$ROOT/.env.deploy"; set +a
PG_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'inventre-deploy-postgres$' | head -1)"
log() { echo "$(date '+%F %T') | $*"; }
mail_alert() {  # subject, body
  local to; to="${ALERT_EMAIL_TO:-}"
  [ -n "$to" ] && command -v msmtp >/dev/null || return 0
  printf 'To: %s\nFrom: Support@inventre.in\nSubject: [Inventre backup] %s\n\n%s\n' "$to" "$1" "$2" | msmtp -t >/dev/null 2>&1 || true
}
# rclone remote "m365" from env — no rclone.conf on disk, so no second copy of the secret.
m365_env() {
  : "${M365_TENANT_ID:?}" "${M365_CLIENT_ID:?}" "${M365_CLIENT_SECRET:?}" "${M365_BACKUP_SITE:?M365_BACKUP_SITE (SharePoint site URL) is not set}"
  export RCLONE_CONFIG_M365_TYPE=onedrive
  export RCLONE_CONFIG_M365_CLIENT_CREDENTIALS=true
  export RCLONE_CONFIG_M365_CLIENT_ID="$M365_CLIENT_ID"
  export RCLONE_CONFIG_M365_CLIENT_SECRET="$M365_CLIENT_SECRET"
  export RCLONE_CONFIG_M365_TENANT="$M365_TENANT_ID"
  export RCLONE_CONFIG_M365_DRIVE_TYPE=documentLibrary
  export RCLONE_CONFIG_M365_DRIVE_ID="$(m365_drive_id)"
  # Everything goes through a crypt layer: file names and contents are encrypted
  # on this server, so SharePoint members and Microsoft see only opaque blobs.
  : "${BACKUP_CRYPT_PASSWORD:?}" "${BACKUP_CRYPT_SALT:?}"
  export RCLONE_CONFIG_M365CRYPT_TYPE=crypt
  export RCLONE_CONFIG_M365CRYPT_REMOTE="m365:Inventre Backups/prod"
  export RCLONE_CONFIG_M365CRYPT_FILENAME_ENCRYPTION=standard
  export RCLONE_CONFIG_M365CRYPT_DIRECTORY_NAME_ENCRYPTION=true
  export RCLONE_CONFIG_M365CRYPT_PASSWORD="$BACKUP_CRYPT_PASSWORD"
  export RCLONE_CONFIG_M365CRYPT_PASSWORD2="$BACKUP_CRYPT_SALT"
}
# The site's default document library id, resolved once through Graph and cached.
m365_drive_id() {
  local cache=/root/.cache/inventre-backup/drive_id; mkdir -p "$(dirname "$cache")"
  if [ -s "$cache" ]; then cat "$cache"; return; fi
  local tok host path id
  tok="$(curl -fsS -m 20 -X POST "https://login.microsoftonline.com/$M365_TENANT_ID/oauth2/v2.0/token" \
        -d client_id="$M365_CLIENT_ID" -d client_secret="$M365_CLIENT_SECRET" -d scope=https://graph.microsoft.com/.default -d grant_type=client_credentials \
        | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')"
  host="$(echo "$M365_BACKUP_SITE" | sed -E 's#https?://([^/]+).*#\1#')"; path="$(echo "$M365_BACKUP_SITE" | sed -E 's#https?://[^/]+(/.*)?#\1#')"
  id="$(curl -fsS -m 20 -H "Authorization: Bearer $tok" "https://graph.microsoft.com/v1.0/sites/${host}:${path}:/drive?\$select=id" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
  [ -n "$id" ] && echo "$id" | tee "$cache"
}
