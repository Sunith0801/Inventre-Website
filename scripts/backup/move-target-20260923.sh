#!/bin/bash
# One-off (2026-09-23): move the encrypted backup mirror from
#   Inventre Help Desk › Documents › Inventre Backups
# to
#   Vendor Management Files AUDIT › Documents › Inventre Backups
# Steps: create the new folder + README, repoint M365_BACKUP_SITE, re-upload
# (~12 GB, ~11 min), verify, then delete the Help Desk copy.
set -euo pipefail
cd /root/Inventre; . scripts/backup/lib.sh
NEWSITE="https://inventre.sharepoint.com/sites/VendorManagementFilesAUDIT"
OLDSITE="https://inventre.sharepoint.com/sites/InventreHelpDesk"
tok() { curl -fsS -m 20 -X POST "https://login.microsoftonline.com/$M365_TENANT_ID/oauth2/v2.0/token" \
  -d client_id="$M365_CLIENT_ID" -d client_secret="$M365_CLIENT_SECRET" \
  -d scope=https://graph.microsoft.com/.default -d grant_type=client_credentials \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])'; }
drive() { curl -fsS -m 20 -H "Authorization: Bearer $1" "https://graph.microsoft.com/v1.0/sites/inventre.sharepoint.com:$2:/drive?\$select=id" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])'; }
TOK="$(tok)"
NEWDRIVE="$(drive "$TOK" /sites/VendorManagementFilesAUDIT)"
echo "▶ creating 'Inventre Backups' in Vendor Management Files AUDIT…"
curl -fsS -m 20 -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/drives/$NEWDRIVE/root/children" \
  -d '{"name":"Inventre Backups","folder":{},"@microsoft.graph.conflictBehavior":"fail"}' >/dev/null 2>&1 || echo "  (folder already exists)"
curl -fsS -m 20 -X PUT -H "Authorization: Bearer $TOK" -H "Content-Type: text/plain" \
  "https://graph.microsoft.com/v1.0/drives/$NEWDRIVE/root:/Inventre%20Backups/README%20-%20do%20not%20edit.txt:/content" \
  --data-binary "Automated, ENCRYPTED production backups of inventre.in (database point-in-time archive, daily full backups, code bundles, config). Written every 5 minutes by the server; file names and contents are encrypted and useless without the server's key. Do not rename, move or delete anything here. Owner: sunith@inventre.in. Runbook: /root/Inventre/docs/runbooks/host-rebuild.md" >/dev/null
echo "▶ repointing M365_BACKUP_SITE…"
sed -i -E "s|^M365_BACKUP_SITE=.*|M365_BACKUP_SITE=$NEWSITE|" .env.deploy
rm -f /root/.cache/inventre-backup/drive_id
echo "▶ uploading to the new location (~12 GB; the 5-minute cron is locked out meanwhile)…"
time scripts/backup/sync-to-m365.sh
echo "▶ verifying (download-and-compare of code + wal)…"
( . scripts/backup/lib.sh; m365_env; rclone check --download /root/backups-archive/code m365crypt:code 2>&1 | tail -1; rclone check --download /root/backups-archive/wal m365crypt:wal 2>&1 | tail -1; rclone size m365crypt: )
echo "▶ deleting the Help Desk copy…"
TOK="$(tok)"; OLDDRIVE="$(drive "$TOK" /sites/InventreHelpDesk)"
curl -fsS -m 30 -X DELETE -H "Authorization: Bearer $TOK" "https://graph.microsoft.com/v1.0/drives/$OLDDRIVE/root:/Inventre%20Backups" \
  && echo "  Help Desk › Inventre Backups removed (it sits in that site's recycle bin for 93 days)"
echo "✓ done — backups now mirror to $NEWSITE/Shared Documents/Inventre Backups"
