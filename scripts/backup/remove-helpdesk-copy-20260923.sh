#!/bin/bash
# One-off (2026-09-23): delete the superseded backup folder in the Help Desk
# site now that the mirror lives in Vendor Management Files AUDIT. The folder
# goes to that site's recycle bin (93 days), so this is reversible.
set -euo pipefail
cd /root/Inventre; . scripts/backup/lib.sh
TOK="$(curl -fsS -m 20 -X POST "https://login.microsoftonline.com/$M365_TENANT_ID/oauth2/v2.0/token" \
  -d client_id="$M365_CLIENT_ID" -d client_secret="$M365_CLIENT_SECRET" \
  -d scope=https://graph.microsoft.com/.default -d grant_type=client_credentials \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')"
OLDDRIVE="$(curl -fsS -m 20 -H "Authorization: Bearer $TOK" "https://graph.microsoft.com/v1.0/sites/inventre.sharepoint.com:/sites/InventreHelpDesk:/drive?\$select=id" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
curl -fsS -m 30 -X DELETE -H "Authorization: Bearer $TOK" "https://graph.microsoft.com/v1.0/drives/$OLDDRIVE/root:/Inventre%20Backups"
echo "✓ Inventre Help Desk › Inventre Backups removed (recoverable from that site's recycle bin for 93 days)"
echo "Current target: $M365_BACKUP_SITE / Shared Documents / Inventre Backups"
( m365_env; rclone size m365crypt: | tail -1 )
