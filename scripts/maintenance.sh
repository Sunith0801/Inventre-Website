#!/usr/bin/env bash
# Maintenance page switch for inventre.in (DR-BCP action D-08).
#
#   scripts/maintenance.sh on      # storefront serves the 503 maintenance page
#   scripts/maintenance.sh off     # storefront live again
#   scripts/maintenance.sh status  # print ON / OFF
#
# The gate is the nginx map in /etc/nginx/sites-available/inventre:
#
#   map $host $maint_on {
#       default 0;      # 0 = off, 1 = on
#   }
#
# This script only ever rewrites the `default N;` line INSIDE that block,
# backs the site file up first, validates with `nginx -t`, and reloads only
# when validation passes (restoring the backup otherwise). /admin and /api
# stay live either way — the gate is on the storefront locations only.
# The page HTML itself is published separately by /root/maintenance/sync.sh.
set -euo pipefail

SITE="${NGINX_SITE:-/etc/nginx/sites-available/inventre}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
BLOCK='/map \$host \$maint_on/,/}/'

usage() {
  echo "usage: $(basename "$0") on|off|status" >&2
  exit 2
}

current() {
  # The `default N;` line inside the map block; anything else is "unknown".
  sed -n -E "${BLOCK}s/^[[:space:]]*default[[:space:]]+([01]);.*/\1/p" "$SITE" | head -n1
}

print_status() {
  case "$(current)" in
    1) echo "maintenance page: ON  (storefront serving 503 page)" ;;
    0) echo "maintenance page: OFF (storefront live)" ;;
    *) echo "maintenance page: UNKNOWN — no 'default 0;' or 'default 1;' found inside 'map \$host \$maint_on' in $SITE" >&2; return 1 ;;
  esac
}

[ $# -eq 1 ] || usage
ACTION="$1"

case "$ACTION" in
  status)
    [ -r "$SITE" ] || { echo "cannot read $SITE (run as root)" >&2; exit 1; }
    print_status
    exit $?
    ;;
  on|off) ;;
  *) usage ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "refusing: '$ACTION' must run as root (it edits $SITE and reloads nginx)" >&2
  exit 1
fi
[ -f "$SITE" ] || { echo "site file not found: $SITE" >&2; exit 1; }
command -v nginx >/dev/null || { echo "nginx binary not found in PATH" >&2; exit 1; }

if [ "$ACTION" = on ]; then WANT=1; else WANT=0; fi
NOW="$(current || true)"
if [ -z "$NOW" ]; then
  echo "refusing: could not find the 'default 0;'/'default 1;' line inside the map block in $SITE" >&2
  exit 1
fi
if [ "$NOW" = "$WANT" ]; then
  echo "already $(print_status)"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/nginx-inventre.$(date +%Y%m%d-%H%M%S)"
cp -p "$SITE" "$BACKUP"
echo "backup: $BACKUP"

# Rewrite ONLY the `default N;` line between `map $host $maint_on {` and the next `}`.
sed -i -E "${BLOCK}s/^([[:space:]]*default[[:space:]]+)[01];/\1${WANT};/" "$SITE"

if [ "$(current)" != "$WANT" ]; then
  echo "edit did not take — restoring $BACKUP" >&2
  cp -p "$BACKUP" "$SITE"
  exit 1
fi

if nginx -t; then
  nginx -s reload
  echo "nginx reloaded"
else
  echo "nginx -t FAILED — restoring $BACKUP and leaving nginx untouched" >&2
  cp -p "$BACKUP" "$SITE"
  exit 1
fi

print_status
echo "reminder: staff can bypass the page with the ?maint=<token> query (token is in the nginx site file / .env.deploy — not printed here)."
echo "reminder: the page HTML is published by /root/maintenance/sync.sh; this switch only turns the gate on/off."
