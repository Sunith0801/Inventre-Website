#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  Inventre — bring production back up on THIS (new) server, automatically
# ═══════════════════════════════════════════════════════════════════════════
# You downloaded the RESTORE folder from SharePoint
#   Vendor Management Files AUDIT › Documents › Inventre Backups › RESTORE
# It holds this script, restore-from-m365.sh, and recovery-kit.env.gpg (every
# secret the rebuild needs, locked with ONE passphrase from the password
# manager: "Inventre recovery kit passphrase").
#
# Run as root on a fresh Ubuntu 22.04/24.04 box, from the folder you copied:
#
#     bash bootstrap-new-server.sh                    # point-in-time, everything up to the last backup
#     bash bootstrap-new-server.sh "2026-09-23 15:40"  # or stop just before a given moment (IST)
#     MODE=dump bash bootstrap-new-server.sh           # simpler: last nightly dump only
#
# It asks for the passphrase once, then: installs tools → downloads the backups
# (≈12 GB) → restores code + configuration → rebuilds the database → builds and
# starts the app on :3010 → prints the short manual tail (DNS, nginx, cron).
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET_TIME="${1:-}"; MODE="${MODE:-pitr}"
KIT="$HERE/recovery-kit.env.gpg"; RESTORE="$HERE/restore-from-m365.sh"
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -f "$KIT" ] || { echo "✖ recovery-kit.env.gpg not found next to this script — download the whole RESTORE folder"; exit 1; }
[ -f "$RESTORE" ] || { echo "✖ restore-from-m365.sh not found next to this script"; exit 1; }
command -v gpg >/dev/null || { apt-get update -qq && apt-get install -y -qq gnupg >/dev/null; }

if [ -z "${RECOVERY_KIT_PASSPHRASE:-}" ]; then
  read -r -s -p "Inventre recovery kit passphrase: " RECOVERY_KIT_PASSPHRASE; echo
fi
gpg --batch --yes --quiet --passphrase "$RECOVERY_KIT_PASSPHRASE" -o /root/restore.env -d "$KIT" || { echo "✖ wrong passphrase or damaged kit"; exit 1; }
chmod 600 /root/restore.env
echo "✓ recovery kit unlocked ($(grep -c '=' /root/restore.env) values)"

chmod +x "$RESTORE"
echo; echo "════ 1/4 fetch backups ════";           "$RESTORE" fetch
echo; echo "════ 2/4 code + configuration ════";   "$RESTORE" code
echo; echo "════ 3/4 database ($MODE) ════"
if [ "$MODE" = dump ]; then "$RESTORE" restore-dump; else "$RESTORE" restore-pitr "$TARGET_TIME"; fi
echo; echo "════ 4/4 start application ════";      "$RESTORE" start
echo
echo "══════════════════════════════════════════════════════════════════"
echo " Inventre is running on this server at http://127.0.0.1:3010"
echo " Left to do by hand (≈20 min) — full list: /root/Inventre/docs/runbooks/restore-from-m365.md §6"
echo "   1. nginx + certbot for inventre.in       4. systemd inventre-wal-stream + pg_hba replication line"
echo "   2. DNS A records → this server's IP      5. /etc/msmtprc mail relay, CCAvenue SFTP user"
echo "   3. cron files from deploy/               6. rename SharePoint 'prod' → 'prod-old-<date>' BEFORE the first sync from here"
echo "══════════════════════════════════════════════════════════════════"
