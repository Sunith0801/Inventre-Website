#!/bin/bash
#
# Watches production for a silent loss of security posture.
#
# WHY. Sixteen checkouts of this repository live on this server, and every one
# of them carries a docker-compose.deploy.yml pointing at the SAME container,
# `inventre-deploy-app`. Exactly one — /root/Inventre — contains the security
# headers, the per-section admin authorization and the September bug fixes.
# A deploy from any of the other fifteen silently reverts all of it, and on
# 2026-09-10 that happened twice within one hour.
#
# Nothing noticed either time. The container reported healthy, the site
# returned 200, and the only symptom was headers quietly missing from a
# response nobody was reading.
#
# This does NOT auto-remediate. Redeploying underneath another engineer who is
# mid-deploy is how you turn one problem into two. It observes and it records,
# loudly, with the build id — so "who deployed and when" has an answer.
#
# Runs from cron every 10 minutes. Read the log with:
#   tail -f /root/Inventre/db_backups/production-monitor.log
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/db_backups/production-monitor.log"
STATE="/tmp/inventre-monitor-last-state"
URL="$(grep -E '^APP_PUBLIC_URL=' "$ROOT/.env.deploy" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
URL="${URL:-https://inventre.in}"
URL="${URL%/}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') | $*" >> "$LOG"; }

BUILD_ID="$(curl -s "$URL/api/version" --max-time 20 | sed -n 's/.*"buildId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
HEADERS="$(curl -sI "$URL" --max-time 20)"

MISSING=""
for h in Strict-Transport-Security X-Content-Type-Options X-Frame-Options \
         Referrer-Policy Permissions-Policy Content-Security-Policy; do
  grep -qi "^$h:" <<<"$HEADERS" || MISSING="$MISSING $h"
done

PREV="$(cat "$STATE" 2>/dev/null || echo "unknown")"

if [ -n "$MISSING" ]; then
  NOW="degraded"
  # Only shout on the TRANSITION, then once an hour, so a long outage does not
  # bury the log in identical lines.
  if [ "$PREV" != "degraded" ] || [ "$(date +%M)" -lt 10 ]; then
    log "🔴 SECURITY POSTURE LOST — build $BUILD_ID is missing:$MISSING"
    log "   A deploy from a checkout other than /root/Inventre has overwritten production."
    log "   Restore with: cd /root/Inventre && ./scripts/deploy.sh --fast"
  fi
else
  NOW="ok"
  [ "$PREV" = "degraded" ] && log "✅ recovered — build $BUILD_ID serves all six headers"
  [ "$PREV" = "unknown" ] && log "monitor started — build $BUILD_ID, all six headers present"
fi

echo "$NOW" > "$STATE"
exit 0
