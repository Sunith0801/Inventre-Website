#!/usr/bin/env bash
# Push the Inventre catalogue — school-wise, grade-wise, SKU-wise, with prices —
# into the audit "NEW KEEPER SKUs" page (table `inventre_sku_catalogue`).
#
# Idempotent: upserts on `sku`, so re-running refreshes prices in place.
#
# Scope rule (user's call, 2026-08-12): push ONLY SKUs that already exist in
# audit `items.erp_name`. The ~390 that do not are NOT invented here — several
# are the same physical garment under a different audit SKU encoding (the
# KIDLINK / TSUS trap), and minting them would duplicate stock on Ground Stock.
# They are reported instead, to `--gaps`.
#
# Writes exactly one table. Touches no `items` row, no stock, no commission.
set -euo pipefail

INV_DB=${INV_DB:-1c61220878ef_inventre-deploy-postgres}
AUDIT_HOST=${AUDIT_HOST:-217.216.58.218}
AUDIT_DB=${AUDIT_DB:-eea78ac5c2ac_erp-new-with-api-db-1}
SSHPW=${SSHPW:-Inventre#2026}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
inv() { docker exec -i "$INV_DB" psql -U inventre -d inventre "$@"; }
audit() { sshpass -p "$SSHPW" ssh -o StrictHostKeyChecking=no "root@$AUDIT_HOST" \
            "docker exec -i $AUDIT_DB psql -U crimpson -d crimpson_erp $*"; }

echo "→ extracting Inventre catalogue…"
inv -tAF$'\t' -f - < "$HERE/sql/catalogue-extract.sql" > "$WORK/full.tsv"
echo "  $(wc -l < "$WORK/full.tsv") SKUs"

echo "→ reading audit item codes…"
audit -tAc '"SELECT erp_name FROM items"' | tr -d '\r' | sort -u > "$WORK/audit.txt"
echo "  $(wc -l < "$WORK/audit.txt") audit items"

# Matched rows only; price/mrp paise → rupees, empty → \N so they land NULL
# (never 0 — a stored zero reads as "free" and would deflate every report).
awk -F'\t' -v OFS='\t' '
  NR==FNR { seen[$0]=1; next }
  !($1 in seen) { print $1 > "/dev/stderr"; next }
  {
    p = ($10 == "" ? "\\N" : $10/100)
    m = ($11 == "" ? "\\N" : $11/100)
    print $1,$2,$3,$4,$5,$6,$7,$8,$9,p,m,($12=="t"?"true":"false"),$1
  }' "$WORK/audit.txt" "$WORK/full.tsv" > "$WORK/push.tsv" 2> "$WORK/gaps.txt"

echo "  pushing $(wc -l < "$WORK/push.tsv") rows; $(wc -l < "$WORK/gaps.txt") SKUs absent from audit (skipped)"

{
  echo 'BEGIN;'
  echo 'CREATE TEMP TABLE _inv_stage (LIKE inventre_sku_catalogue INCLUDING DEFAULTS) ON COMMIT DROP;'
  echo 'ALTER TABLE _inv_stage DROP COLUMN id, DROP COLUMN synced_at;'
  echo "COPY _inv_stage (sku,item_name,school_name,school_code,grades,category,kind,size,colour,price,mrp,active,matched_item_code) FROM STDIN;"
  cat "$WORK/push.tsv"
  echo '\.'
  cat <<'SQL'
INSERT INTO inventre_sku_catalogue
  (sku,item_name,school_name,school_code,grades,category,kind,size,colour,price,mrp,active,matched_item_code,synced_at)
SELECT sku,
       nullif(item_name,''), nullif(school_name,''), nullif(school_code,''),
       nullif(grades,''), nullif(category,''), nullif(kind,''),
       nullif(size,''), nullif(colour,''),
       price, mrp, active, nullif(matched_item_code,''), now()
FROM _inv_stage
ON CONFLICT (sku) DO UPDATE SET
  item_name=EXCLUDED.item_name, school_name=EXCLUDED.school_name,
  school_code=EXCLUDED.school_code, grades=EXCLUDED.grades,
  category=EXCLUDED.category, kind=EXCLUDED.kind, size=EXCLUDED.size,
  colour=EXCLUDED.colour, price=EXCLUDED.price, mrp=EXCLUDED.mrp,
  active=EXCLUDED.active, matched_item_code=EXCLUDED.matched_item_code,
  synced_at=now();
COMMIT;
SELECT count(*) AS rows, count(price) AS priced, count(DISTINCT school_code) AS schools
FROM inventre_sku_catalogue;
SQL
} > "$WORK/push.sql"

echo "→ upserting into audit…"
sshpass -p "$SSHPW" ssh -o StrictHostKeyChecking=no "root@$AUDIT_HOST" \
  "docker exec -i $AUDIT_DB psql -U crimpson -d crimpson_erp -v ON_ERROR_STOP=1" \
  < "$WORK/push.sql"

if [ -n "${1:-}" ] && [ "${1:-}" = "--gaps" ]; then
  cp "$WORK/gaps.txt" "${2:-./catalogue-gaps.txt}"
  echo "→ gap list written to ${2:-./catalogue-gaps.txt}"
fi
