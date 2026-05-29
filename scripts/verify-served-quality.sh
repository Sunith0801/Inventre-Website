#!/usr/bin/env bash
# Verify what bytes the live site actually serves to a browser.
#
# Hits the site's /images/* and /erp-media/* URLs (following redirects),
# captures the final URL + Content-Length + cache headers, and compares to
# the local original in public.r2-backup/.
#
# Usage:
#   bash scripts/verify-served-quality.sh https://inventre.in
#   bash scripts/verify-served-quality.sh https://staging.inventre.in

set -euo pipefail

SITE="${1:-https://inventre.in}"
echo "Probing $SITE (follows redirects to R2)..."
echo

check() {
  local path="$1"
  local localfile="$2"
  local local_size remote_size final_url cache_ctl
  if [[ -f "$localfile" ]]; then
    local_size=$(stat -c%s "$localfile")
  else
    local_size="?"
  fi
  # -L follows redirects, -I = HEAD
  local headers
  headers=$(curl -sIL -A "Mozilla/5.0 quality-check" "$SITE$path" 2>/dev/null || true)
  remote_size=$(echo "$headers" | awk 'BEGIN{IGNORECASE=1}/^content-length:/{x=$2} END{print x}' | tr -d '\r')
  cache_ctl=$(echo "$headers"  | awk 'BEGIN{IGNORECASE=1}/^cache-control:/{$1=""; print substr($0,2)}' | tail -1 | tr -d '\r')
  final_url=$(curl -sIL -A "Mozilla/5.0 quality-check" -o /dev/null -w "%{url_effective}" "$SITE$path" 2>/dev/null || true)

  local status
  if [[ "$remote_size" == "$local_size" ]]; then status="OK"
  elif [[ -z "$remote_size" ]]; then status="MISSING"
  else status="DEGRADED"
  fi

  printf "  %-8s  %s\n" "$status" "$path"
  printf "            local=%s  served=%s\n" "$local_size" "${remote_size:-?}"
  printf "            final=%s\n" "$final_url"
  printf "            cache-control=%s\n\n" "${cache_ctl:-?}"
}

echo "== Images =="
check "/images/quality1.png"        "public.r2-backup/images/quality1.png"
check "/images/Sports uniform.png"  "public.r2-backup/images/Sports uniform.png"
check "/images/INVENTRE_LOGO.png"   "public.r2-backup/images/INVENTRE_LOGO.png"

echo "== Videos =="
check "/images/Magic_Box.mp4"  "public.r2-backup/images/Magic_Box.mp4"
check "/images/slider_1.mp4"   "public.r2-backup/images/slider_1.mp4"

echo "== ERP media (sample) =="
sample=$(ls public.r2-backup/erp-media | head -2)
while read -r f; do check "/erp-media/$f" "public.r2-backup/erp-media/$f"; done <<<"$sample"

echo "Done. Any line marked DEGRADED means the live site is still serving a smaller-than-local copy."
echo "If everything says OK but images still look blurry in the browser, the cause is CSS/display"
echo "sizing — the page is asking the browser to downscale an oversize master, not an R2 issue."
