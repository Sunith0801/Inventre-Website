#!/bin/bash
#
# Post-deploy verification. Asserts that what is SERVING is what you shipped.
#
# WHY THIS EXISTS. On 2026-09-10 security headers and per-section admin
# authorization were deployed in the morning and were gone by noon: somebody
# rebuilt the image from a branch that did not carry those commits. Every
# existing gate passed — typecheck, 26 tests, the deploy preflight, and the
# container's own health check — because none of them looks at the running
# site. deploy.sh waited for a "Ready" line in the logs and declared success.
#
# A container that boots happily while serving the wrong build is exactly the
# failure this catches. Two of the four checks below are the ones that would
# have caught it:
#
#   * BUILD PROVENANCE — the live /api/version buildId must equal the id of
#     the build we just produced. If someone else's artefact is serving, this
#     fails no matter how healthy the container looks.
#   * SECURITY HEADERS — present on the live response, not merely present in
#     the source. A commented-out block passes a grep; it does not pass this.
#
# Usage:  scripts/verify-deployment.sh [expected-build-id]
# Exit:   0 = everything asserted holds, 1 = at least one assertion failed
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_BUILD_ID="${1:-}"
EXPECTED_GIT_SHA="${2:-}"
TIMEOUT=20
RETRIES=15

# VERIFY_URL overrides the target — the recovery kit sets it to the local port on
# a rebuilt server, where the restored APP_PUBLIC_URL still names the OLD host.
URL="${VERIFY_URL:-$(grep -E '^APP_PUBLIC_URL=' "$ROOT/.env.deploy" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)}"
URL="${URL:-https://inventre.in}"
URL="${URL%/}"

FAILURES=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

echo "▶ Verifying $URL"

# ── wait for the app to answer at all ───────────────────────────────────────
ready=0
for _ in $(seq 1 $RETRIES); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL" --max-time $TIMEOUT)" = "200" ]; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" != "1" ]; then
  fail "the site never returned 200 (waited $((RETRIES * 2))s)"
  echo "✖ Verification FAILED — $FAILURES check(s)"
  exit 1
fi
pass "homepage returns 200"

# ── 1. build provenance ─────────────────────────────────────────────────────
VERSION_JSON="$(curl -s "$URL/api/version" --max-time $TIMEOUT)"
LIVE_BUILD_ID="$(sed -n 's/.*"buildId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$VERSION_JSON")"
LIVE_GIT_SHA="$(sed -n 's/.*"gitSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$VERSION_JSON")"
LIVE_DIRTY="$(sed -n 's/.*"dirty"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p' <<<"$VERSION_JSON")"
if [ -z "$EXPECTED_BUILD_ID" ]; then
  pass "serving build ${LIVE_BUILD_ID:-unknown} (no expected id given — provenance not asserted)"
elif [ "$LIVE_BUILD_ID" = "$EXPECTED_BUILD_ID" ]; then
  pass "serving the build we just made ($LIVE_BUILD_ID)"
else
  fail "WRONG BUILD IS SERVING — expected $EXPECTED_BUILD_ID, live is ${LIVE_BUILD_ID:-unknown}"
fi
if [ -n "$EXPECTED_GIT_SHA" ] && [ "$EXPECTED_GIT_SHA" != "unknown" ]; then
  if [ "$LIVE_GIT_SHA" = "$EXPECTED_GIT_SHA" ]; then
    pass "live commit is ${LIVE_GIT_SHA:0:12}$([ "$LIVE_DIRTY" = "true" ] && echo ' (built from a DIRTY tree)')"
  else
    fail "WRONG COMMIT IS SERVING — expected ${EXPECTED_GIT_SHA:0:12}, live is ${LIVE_GIT_SHA:-unknown}"
  fi
elif [ -n "$LIVE_GIT_SHA" ]; then
  pass "live commit ${LIVE_GIT_SHA:0:12}$([ "$LIVE_DIRTY" = "true" ] && echo ' (dirty tree)')"
fi

# ── 2. security headers, on the live response ───────────────────────────────
HEADERS="$(curl -sI "$URL" --max-time $TIMEOUT)"
for h in Strict-Transport-Security X-Content-Type-Options X-Frame-Options \
         Referrer-Policy Permissions-Policy Content-Security-Policy; do
  if grep -qi "^$h:" <<<"$HEADERS"; then
    pass "header $h"
  else
    fail "header $h is MISSING from the live response"
  fi
done

# ── 3. the admin door still opens ───────────────────────────────────────────
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL/admin/login" --max-time $TIMEOUT)"
[ "$CODE" = "200" ] && pass "/admin/login returns 200" || fail "/admin/login returned $CODE"

# ── 4. the storefront still redirects rather than erroring ──────────────────
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL/shop" --max-time $TIMEOUT)"
case "$CODE" in
  200|301|302|307|308) pass "/shop responds ($CODE)" ;;
  *) fail "/shop returned $CODE" ;;
esac

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "✓ Deployment verified"
  exit 0
fi
echo "✖ Verification FAILED — $FAILURES check(s) did not hold"
exit 1
