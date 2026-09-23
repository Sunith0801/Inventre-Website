#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  Rebuild Inventre production on a NEW server from the Microsoft 365 backups
# ═══════════════════════════════════════════════════════════════════════════
# Run as root on a fresh Ubuntu box, in this order:
#
#   1. ./restore-from-m365.sh fetch          download dump, base backup, WAL, code, snapshot
#   2. ./restore-from-m365.sh code           clone the code bundle → /root/Inventre, decrypt .env.deploy
#   3. ./restore-from-m365.sh restore-dump   DB from the newest daily dump        (simplest; loses up to 24 h)
#      — or —
#      ./restore-from-m365.sh restore-pitr ["YYYY-MM-DD HH:MM:SS"]
#                                            DB from base backup + WAL to that moment (loses ≈ 5 min)
#   4. ./restore-from-m365.sh start          data stores + build + app on :3010
#
# Needs ONLY the seven values kept in the company password manager, written
# to /root/restore.env first (see docs/runbooks/restore-from-m365.md):
#   M365_TENANT_ID  M365_CLIENT_ID  M365_CLIENT_SECRET  M365_BACKUP_SITE
#   BACKUP_CRYPT_PASSWORD  BACKUP_CRYPT_SALT  SNAPSHOT_PASSPHRASE
# Every mode is safe to re-run. Work dir: /root/restore
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail
MODE="${1:-}"; TARGET_TIME="${2:-}"
R=/root/restore; mkdir -p "$R"
log() { echo "▶ $*"; }
die() { echo "✖ $*" >&2; exit 1; }

[ -f /root/restore.env ] || die "/root/restore.env missing — write the seven values from the password manager first"
set -a; . /root/restore.env; set +a
for v in M365_TENANT_ID M365_CLIENT_ID M365_CLIENT_SECRET M365_BACKUP_SITE BACKUP_CRYPT_PASSWORD BACKUP_CRYPT_SALT; do
  [ -n "${!v:-}" ] || die "$v is empty in /root/restore.env"
done

need() { command -v "$1" >/dev/null 2>&1; }
ensure_tools() {
  need curl || apt-get install -y -qq curl >/dev/null
  need python3 || apt-get install -y -qq python3 >/dev/null
  need gpg || apt-get install -y -qq gnupg >/dev/null
  need git || apt-get install -y -qq git >/dev/null
  if ! need rclone; then log "installing rclone"; curl -fsS https://rclone.org/install.sh | bash >/dev/null; fi
  if ! need docker; then log "installing docker"; apt-get update -qq && apt-get install -y -qq docker.io docker-compose-plugin >/dev/null; systemctl enable --now docker; fi
}

# rclone remotes from env — identical to scripts/backup/lib.sh on the old host
setup_rclone() {
  local tok host path drive
  tok="$(curl -fsS -m 20 -X POST "https://login.microsoftonline.com/$M365_TENANT_ID/oauth2/v2.0/token" \
    -d client_id="$M365_CLIENT_ID" -d client_secret="$M365_CLIENT_SECRET" -d scope=https://graph.microsoft.com/.default -d grant_type=client_credentials \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')"
  host="$(echo "$M365_BACKUP_SITE" | sed -E 's#https?://([^/]+).*#\1#')"; path="$(echo "$M365_BACKUP_SITE" | sed -E 's#https?://[^/]+(/.*)?#\1#')"
  drive="$(curl -fsS -m 20 -H "Authorization: Bearer $tok" "https://graph.microsoft.com/v1.0/sites/${host}:${path}:/drive?\$select=id" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')"
  export RCLONE_CONFIG_M365_TYPE=onedrive RCLONE_CONFIG_M365_CLIENT_CREDENTIALS=true \
         RCLONE_CONFIG_M365_CLIENT_ID="$M365_CLIENT_ID" RCLONE_CONFIG_M365_CLIENT_SECRET="$M365_CLIENT_SECRET" \
         RCLONE_CONFIG_M365_TENANT="$M365_TENANT_ID" RCLONE_CONFIG_M365_DRIVE_TYPE=documentLibrary RCLONE_CONFIG_M365_DRIVE_ID="$drive" \
         RCLONE_CONFIG_M365CRYPT_TYPE=crypt RCLONE_CONFIG_M365CRYPT_REMOTE="m365:Inventre Backups/prod" \
         RCLONE_CONFIG_M365CRYPT_FILENAME_ENCRYPTION=standard RCLONE_CONFIG_M365CRYPT_DIRECTORY_NAME_ENCRYPTION=true \
         RCLONE_CONFIG_M365CRYPT_PASSWORD="$BACKUP_CRYPT_PASSWORD" RCLONE_CONFIG_M365CRYPT_PASSWORD2="$BACKUP_CRYPT_SALT"
}
RC="--transfers 4 --checkers 8 --retries 3 --low-level-retries 10 -q"

pg_password() {  # from the restored .env.deploy (step "code" writes it)
  [ -f /root/Inventre/.env.deploy ] || die "run the 'code' step first — it restores .env.deploy, which holds POSTGRES_PASSWORD"
  grep -E '^POSTGRES_PASSWORD=' /root/Inventre/.env.deploy | head -1 | cut -d= -f2- | tr -d '"'
}
fresh_volume() { docker rm -f inventre-restore-pg >/dev/null 2>&1 || true; docker volume rm -f inventre-deploy_pgdata >/dev/null 2>&1 || true; docker volume create inventre-deploy_pgdata >/dev/null; }
report_db() {
  docker exec inventre-restore-pg psql -U inventre -d inventre -Atc \
    "select 'tables='||(select count(*) from information_schema.tables where table_schema='public')||' orders='||(select count(*) from orders)||' students='||(select count(*) from students)||' newest order='||coalesce((select max(placed_at)::text from orders),'-')"
  docker rm -f inventre-restore-pg >/dev/null
  echo "✓ data volume inventre-deploy_pgdata is ready. Next: ./restore-from-m365.sh start"
}

case "$MODE" in
fetch)
  ensure_tools; setup_rclone
  log "what the backup holds:"; rclone lsd m365crypt: ; rclone size m365crypt: | tail -1
  log "newest daily dump → $R/dumps"
  d="$(rclone lsf m365crypt:dumps/daily | sort | tail -1)"; [ -n "$d" ] && rclone copy $RC "m365crypt:dumps/daily/$d" "$R/dumps/"
  log "newest base backup → $R/base"
  b="$(rclone lsf --dirs-only m365crypt:base | sort | tail -1)"; [ -n "$b" ] && rclone copy $RC "m365crypt:base/$b" "$R/base/${b%/}/"
  log "all WAL segments → $R/wal"
  rclone copy $RC m365crypt:wal "$R/wal/"
  log "newest code bundle → $R/code"
  c="$(rclone lsf m365crypt:code | sort | tail -1)"; [ -n "$c" ] && rclone copy $RC "m365crypt:code/$c" "$R/code/"
  log "newest encrypted snapshot (carries .env.deploy) → $R/snapshots"
  s="$(rclone lsf m365crypt:snapshots | sort | tail -1)"; [ -n "$s" ] && rclone copy $RC "m365crypt:snapshots/$s" "$R/snapshots/"
  echo; echo "✓ fetched:"; du -sh "$R"/* 2>/dev/null; echo "Next: ./restore-from-m365.sh code"
  ;;

code)
  ensure_tools
  BUNDLE="$(ls -1t "$R"/code/*.bundle 2>/dev/null | head -1)"; SNAP="$(ls -1t "$R"/snapshots/*.tar.gz 2>/dev/null | head -1)"
  [ -f "$BUNDLE" ] && [ -f "$SNAP" ] || die "run fetch first"
  : "${SNAPSHOT_PASSPHRASE:?SNAPSHOT_PASSPHRASE (password manager) is needed to decrypt .env.deploy}"
  if [ ! -d /root/Inventre/.git ]; then log "cloning code from $(basename "$BUNDLE")"; git clone -q "$BUNDLE" /root/Inventre; fi
  cd /root/Inventre
  # the branch that was live is recorded in the bundle's HEAD; fall back to the newest branch
  git checkout -q "$(git bundle list-heads "$BUNDLE" | awk '/refs\/heads\//{print $2}' | sed 's#refs/heads/##' | grep -m1 -E '^(feat/ground-stock-availability|main)$' || echo main)" 2>/dev/null || true
  log "restoring .env.deploy from the encrypted snapshot"
  rm -rf "$R/snap"; mkdir -p "$R/snap"; tar -xzf "$SNAP" -C "$R/snap"
  ENVGPG="$(find "$R/snap" -name 'env.deploy.gpg' | head -1)"; [ -f "$ENVGPG" ] || die "snapshot has no env/env.deploy.gpg"
  gpg --batch --yes --quiet --passphrase "$SNAPSHOT_PASSPHRASE" -o /root/Inventre/.env.deploy -d "$ENVGPG"; chmod 640 /root/Inventre/.env.deploy
  echo "✓ code at /root/Inventre ($(git log -1 --format='%h %s' | cut -c1-70)); .env.deploy restored. Next: restore-dump or restore-pitr"
  ;;

restore-dump)
  ensure_tools
  DUMP="$(ls -1t "$R"/dumps/*.dump 2>/dev/null | head -1)"; [ -f "$DUMP" ] || die "run fetch first"
  PW="$(pg_password)"
  log "fresh Postgres 16 on volume inventre-deploy_pgdata, restoring $(basename "$DUMP")"
  fresh_volume
  docker run -d --name inventre-restore-pg -v inventre-deploy_pgdata:/var/lib/postgresql/data -e POSTGRES_USER=inventre -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=inventre postgres:16-alpine >/dev/null
  for _ in $(seq 1 60); do docker exec inventre-restore-pg pg_isready -U inventre -q 2>/dev/null && break; sleep 2; done
  docker exec -i inventre-restore-pg pg_restore -U inventre -d inventre --no-owner --no-acl < "$DUMP" 2> "$R/pg_restore.err" || true
  echo "  (pg_restore warnings, if any, are in $R/pg_restore.err)"
  report_db
  ;;

restore-pitr)
  ensure_tools
  BASE_DIR="$(ls -1d "$R"/base/*/ 2>/dev/null | sort | tail -1)"; [ -f "${BASE_DIR}base.tar.gz" ] || die "run fetch first"
  PW="$(pg_password)"
  log "point-in-time restore from $(basename "$BASE_DIR") + WAL${TARGET_TIME:+ to $TARGET_TIME}"
  rm -rf "$R/wal-plain"; mkdir -p "$R/wal-plain"
  for f in "$R"/wal/*.gz "$R"/wal/*.gz.partial; do [ -f "$f" ] || continue; out="$(basename "$f")"; out="${out%.partial}"; out="${out%.gz}"; gunzip -c "$f" > "$R/wal-plain/$out" 2>/dev/null || true; done
  fresh_volume
  docker run --rm -v inventre-deploy_pgdata:/data -v "$BASE_DIR":/base:ro -e TT="$TARGET_TIME" alpine sh -c '
    set -e; cd /data && tar -xzf /base/base.tar.gz
    rm -rf /data/pg_wal && mkdir -p /data/pg_wal
    echo "restore_command = '"'"'cp /walarchive/%f %p'"'"'" >> /data/postgresql.auto.conf
    if [ -n "$TT" ]; then echo "recovery_target_time = '"'"'$TT'"'"'" >> /data/postgresql.auto.conf; echo "recovery_target_action = '"'"'promote'"'"'" >> /data/postgresql.auto.conf; fi
    touch /data/recovery.signal; chown -R 70:70 /data'
  log "Postgres replays WAL (this can take minutes), then promotes"
  docker run -d --name inventre-restore-pg -v inventre-deploy_pgdata:/var/lib/postgresql/data -v "$R/wal-plain":/walarchive:ro -e POSTGRES_PASSWORD="$PW" postgres:16-alpine >/dev/null
  for _ in $(seq 1 240); do
    if docker exec inventre-restore-pg pg_isready -U inventre -q 2>/dev/null && [ "$(docker exec inventre-restore-pg psql -U inventre -d inventre -Atc 'select pg_is_in_recovery()' 2>/dev/null)" = "f" ]; then break; fi
    sleep 5
  done
  report_db
  ;;

start)
  ensure_tools
  cd /root/Inventre 2>/dev/null || die "run the 'code' step first"
  [ -f .env.deploy ] || die ".env.deploy missing — run the 'code' step"
  docker volume ls -q | grep -q '^inventre-deploy_pgdata$' || die "no restored data volume — run restore-dump or restore-pitr first"
  log "node + dependencies"
  need node || { curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null; apt-get install -y -qq nodejs >/dev/null; }
  npm ci --no-audit --no-fund >/dev/null
  log "data stores"
  docker compose -p inventre-deploy --env-file .env.deploy -f docker-compose.deploy.yml up -d postgres pgbouncer redis minio >/dev/null
  log "build + start the application (migrations run on boot)"
  ./scripts/deploy.sh --allow-dirty --skip-verify
  echo; echo "✓ Inventre is answering on :3010. Finish by hand (≈20 min), see docs/runbooks/restore-from-m365.md:"
  echo "   nginx + certbot, DNS A record, cron files, systemd inventre-wal-stream, CCAvenue SFTP user, /etc/msmtprc, re-enable backups."
  ;;
*) echo "usage: $0 fetch | code | restore-dump | restore-pitr [\"YYYY-MM-DD HH:MM:SS\"] | start"; exit 2 ;;
esac
