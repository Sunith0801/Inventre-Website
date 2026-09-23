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
  if ! need docker; then
    log "installing docker"
    apt-get update -qq
    # Ubuntu 24.04 ships the compose v2 plugin as `docker-compose-v2`; the name
    # `docker-compose-plugin` only exists in Docker's own apt repository. Try
    # the distro package first, then fall back to Docker's repo. (Found by the
    # first clean-VM drill, 2026-09-24: the kit died here after 18 s.)
    if ! apt-get install -y -qq docker.io docker-compose-v2 >/dev/null 2>&1; then
      log "distro packages unavailable — using Docker's apt repository"
      apt-get install -y -qq ca-certificates curl >/dev/null
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
      apt-get update -qq && apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
    fi
    systemctl enable --now docker
  fi
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is not available after install"
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
# PG_VOLUME may be overridden (e.g. PG_VOLUME=inventre-drill) to rehearse on a host
# that already runs production — the default is the volume the compose stack uses.
PG_VOLUME="${PG_VOLUME:-inventre-deploy_pgdata}"
fresh_volume() { docker rm -f inventre-restore-pg >/dev/null 2>&1 || true; docker volume rm -f "$PG_VOLUME" >/dev/null 2>&1 || true; docker volume create "$PG_VOLUME" >/dev/null; }
report_db() {
  docker exec inventre-restore-pg psql -U inventre -d inventre -Atc \
    "select 'tables='||(select count(*) from information_schema.tables where table_schema='public')||' orders='||(select count(*) from orders)||' students='||(select count(*) from students)||' newest order='||coalesce((select max(placed_at)::text from orders),'-')"
  docker rm -f inventre-restore-pg >/dev/null
  echo "✓ data volume $PG_VOLUME is ready. Next: ./restore-from-m365.sh start"
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
  # newest by MODIFICATION TIME, bundles only. Sorting by name picked
  # `uncommitted-latest.txt` (u > i) and, among bundles, a random sha — found
  # by the first clean-VM drill, 2026-09-24.
  c="$(rclone lsf --files-only --include '*.bundle' --format tp --separator '|' m365crypt:code | sort | tail -1 | cut -d'|' -f2)"; [ -n "$c" ] && rclone copy $RC "m365crypt:code/$c" "$R/code/"
  log "latest encrypted .env.deploy → $R/config"; rclone copy $RC m365crypt:config "$R/config/" || true
  log "uncommitted code changes at the time of the last sync (if any) → $R/code"; rclone copy $RC --include 'uncommitted-latest.*' m365crypt:code "$R/code/" || true
  log "newest encrypted snapshot (carries .env.deploy too) → $R/snapshots"
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
  ENVGPG="$R/config/env.deploy.gpg"   # refreshed within 5 min of any edit on the old host
  [ -f "$ENVGPG" ] || ENVGPG="$(find "$R/snap" -name 'env.deploy.gpg' | head -1)"; [ -f "$ENVGPG" ] || die "no encrypted .env.deploy found (config/ or snapshot)"
  gpg --batch --yes --quiet --passphrase "$SNAPSHOT_PASSPHRASE" -o /root/Inventre/.env.deploy -d "$ENVGPG"; chmod 640 /root/Inventre/.env.deploy
  if [ -f "$R/code/uncommitted-latest.tar.gz" ]; then
    log "re-applying files that were edited but not committed on the old host (list: $R/code/uncommitted-latest.txt)"
    tar -xzf "$R/code/uncommitted-latest.tar.gz" -C /root/Inventre
  fi
  echo "✓ code at /root/Inventre ($(git log -1 --format='%h %s' | cut -c1-70)); .env.deploy restored. Next: restore-dump or restore-pitr"
  ;;

restore-dump)
  ensure_tools
  DUMP="$(ls -1t "$R"/dumps/*.dump 2>/dev/null | head -1)"; [ -f "$DUMP" ] || die "run fetch first"
  PW="$(pg_password)"
  log "fresh Postgres 16 on volume inventre-deploy_pgdata, restoring $(basename "$DUMP")"
  fresh_volume
  docker run -d --name inventre-restore-pg -v "$PG_VOLUME":/var/lib/postgresql/data -e POSTGRES_USER=inventre -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=inventre postgres:16-alpine >/dev/null
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
  # The in-progress (.partial) segment is shorter than 16 MB; Postgres aborts the
  # whole recovery on it ("has wrong size"). Zero-pad so it reads as end-of-WAL.
  for f in "$R"/wal-plain/*; do [ -f "$f" ] && [ "$(stat -c %s "$f")" -lt 16777216 ] && truncate -s 16777216 "$f"; done
  fresh_volume
  docker run --rm -v "$PG_VOLUME":/data -v "$BASE_DIR":/base:ro -e TT="$TARGET_TIME" alpine sh -c '
    set -e; cd /data && tar -xzf /base/base.tar.gz
    rm -rf /data/pg_wal && mkdir -p /data/pg_wal
    echo "restore_command = '"'"'cp /walarchive/%f %p'"'"'" >> /data/postgresql.auto.conf
    if [ -n "$TT" ]; then echo "recovery_target_time = '"'"'$TT'"'"'" >> /data/postgresql.auto.conf; echo "recovery_target_action = '"'"'promote'"'"'" >> /data/postgresql.auto.conf; fi
    touch /data/recovery.signal; chown -R 70:70 /data'
  log "Postgres replays WAL (this can take minutes), then promotes"
  docker run -d --name inventre-restore-pg -v "$PG_VOLUME":/var/lib/postgresql/data -v "$R/wal-plain":/walarchive:ro -e POSTGRES_PASSWORD="$PW" postgres:16-alpine >/dev/null
  for _ in $(seq 1 240); do
    if docker exec inventre-restore-pg pg_isready -U inventre -q 2>/dev/null && [ "$(docker exec inventre-restore-pg psql -U inventre -d inventre -Atc 'select pg_is_in_recovery()' 2>/dev/null)" = "f" ]; then break; fi
    [ "$(docker inspect -f '{{.State.Running}}' inventre-restore-pg 2>/dev/null)" = "true" ] || { docker logs --tail 20 inventre-restore-pg; die "Postgres exited during WAL replay — see the log above"; }
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
  # docker-compose.deploy.yml joins the app to the audit staging stack's network,
  # which exists only on the old host. Create an empty one so the app container
  # can be created on a clean server (found by the clean-VM drill, 2026-09-24).
  for net in $(grep -oE '^\s+name:\s*\S+' docker-compose.deploy.yml | awk '{print $2}'; echo erp-staging_default); do
    docker network inspect "$net" >/dev/null 2>&1 || docker network create "$net" >/dev/null
  done
  log "data stores"
  docker compose -p inventre-deploy --env-file .env.deploy -f docker-compose.deploy.yml up -d postgres pgbouncer redis minio >/dev/null
  log "build + start the application (migrations run on boot)"
  # post-deploy verification must look at THIS server, not the public URL in the
  # restored .env.deploy (clean-VM drill 2026-09-24: it compared against the old
  # host, "failed" and rolled back a healthy build)
  VERIFY_URL=http://127.0.0.1:3010 ./scripts/deploy.sh --allow-dirty --skip-verify
  echo; echo "✓ Inventre is answering on :3010. Finish by hand (≈20 min), see docs/runbooks/restore-from-m365.md:"
  echo "   nginx + certbot, DNS A record, cron files, systemd inventre-wal-stream, CCAvenue SFTP user, /etc/msmtprc, re-enable backups."
  ;;
*) echo "usage: $0 fetch | code | restore-dump | restore-pitr [\"YYYY-MM-DD HH:MM:SS\"] | start"; exit 2 ;;
esac
