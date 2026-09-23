#!/bin/bash
# Keep the self-contained recovery kit in the backup folder current.
# Publishes (UNencrypted, so a human can open the folder and read them):
#   RESTORE/README-RESTORE.md        what this is and the 3 commands
#   RESTORE/bootstrap-new-server.sh  one command that rebuilds a server
#   RESTORE/restore-from-m365.sh     the step engine it drives
#   RESTORE/recovery-kit.env.gpg     every secret the rebuild needs, AES-256,
#                                    locked with RECOVERY_KIT_PASSPHRASE
# Called by sync-to-m365.sh on every run (cheap: four small files).
set -uo pipefail; . "$(dirname "$0")/lib.sh"
: "${RECOVERY_KIT_PASSPHRASE:?RECOVERY_KIT_PASSPHRASE missing from .env.deploy}"
KIT_DIR=/root/.cache/inventre-backup/RESTORE; mkdir -p "$KIT_DIR"; chmod 700 "$KIT_DIR"
# the seven values the new server needs, plus the ones the app needs on boot that
# are NOT in the encrypted snapshot's env (none today — .env.deploy carries all)
{
  echo "# Inventre recovery kit — generated $(date -Is) on $(hostname). Decrypt with the recovery kit passphrase."
  grep -E '^(M365_TENANT_ID|M365_CLIENT_ID|M365_CLIENT_SECRET|M365_BACKUP_SITE|BACKUP_CRYPT_PASSWORD|BACKUP_CRYPT_SALT|SNAPSHOT_PASSPHRASE)=' "$ROOT/.env.deploy"
} > "$KIT_DIR/recovery-kit.env"
gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --passphrase "$RECOVERY_KIT_PASSPHRASE" -o "$KIT_DIR/recovery-kit.env.gpg" "$KIT_DIR/recovery-kit.env"
rm -f "$KIT_DIR/recovery-kit.env"
cp "$ROOT/scripts/backup/bootstrap-new-server.sh" "$ROOT/scripts/backup/restore-from-m365.sh" "$KIT_DIR/"
cat > "$KIT_DIR/README-RESTORE.md" <<EOF
# Inventre production — how to bring it back on a new server

Everything in the folder above this one (\`prod/\`) is the live, encrypted backup of
inventre.in: database (point-in-time, every 5 minutes), daily full backups, code,
configuration. This RESTORE folder is the key to using it. Updated: $(date '+%Y-%m-%d %H:%M %Z').

## You need
1. A fresh Ubuntu 22.04/24.04 server with root access (4 vCPU, 16 GB RAM, 200 GB disk).
2. This RESTORE folder copied onto it (download it from SharePoint, then scp).
3. The **Inventre recovery kit passphrase** from the company password manager.

## Do
\`\`\`
cd RESTORE
bash bootstrap-new-server.sh
\`\`\`
Enter the passphrase when asked. About 60 minutes later the site is running on
port 3010 with the data as of the last backup (minutes old). Then point DNS and
nginx at the server as the script prints at the end.

Options: \`bash bootstrap-new-server.sh "2026-09-23 15:40"\` restores to that moment;
\`MODE=dump bash bootstrap-new-server.sh\` uses the last nightly dump instead.

## If you are an AI assistant reading this
Run \`bootstrap-new-server.sh\` as root from this folder; ask the operator only for the
passphrase. Do not hand-edit the scripts; the runbook is at
\`/root/Inventre/docs/runbooks/restore-from-m365.md\` once the code is restored.

Last code commit backed up: $(cd "$ROOT" && git log -1 --format='%h %s (%ci)' | cut -c1-90)
EOF
m365_env || exit 1
rclone sync --transfers 2 -q "$KIT_DIR" "m365:Inventre Backups/RESTORE" && log "recovery kit published" || { log "recovery kit publish FAILED"; exit 1; }
