#!/bin/bash
# One-time backfill of erp.sales_orders.student (Enrollment ID / ref shown on
# audit.inventre.in order headers) for the /admin/orders Excel export.
#
#   Step A: copy enrollment_number out of the locally stored raw header JSON
#           (covers rows synced by the orders poll, ~12.8k).
#   Step B: page audit prod's /api/orders list (carries enrollment_number in
#           bulk) and fill the rest by erp_name (~6.8k, incl. pre-poll rows).
#
# Idempotent: only touches rows where student IS NULL / ''. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

export DB_URL="${DATABASE_URL:-postgres://inventre:inventre_prod@localhost:6433/inventre}"
export ERP_BASE=$(grep -E '^PROD_ERP_API_BASE_URL=' .env.deploy | cut -d= -f2- | tr -d '"')
export ERP_USER=$(grep -E '^PROD_ERP_POLL_USER=' .env.deploy | cut -d= -f2- | tr -d '"')
export ERP_PASS=$(grep -E '^PROD_ERP_POLL_PASS=' .env.deploy | cut -d= -f2- | tr -d '"')

echo "▶ Step A: backfill from locally stored raw header JSON…"
psql "$DB_URL" -c "
  UPDATE erp.sales_orders
     SET student = NULLIF(raw->>'enrollment_number', '')
   WHERE (student IS NULL OR student = '')
     AND NULLIF(raw->>'enrollment_number', '') IS NOT NULL;"

echo "▶ Step B: sweep audit API for the remainder…"
python3 - <<'PY'
import json, os, subprocess, urllib.parse, urllib.request

base = os.environ["ERP_BASE"].rstrip("/")
db   = os.environ["DB_URL"]

login = urllib.request.Request(
    f"{base}/api/auth/login",
    data=urllib.parse.urlencode({
        "username": os.environ["ERP_USER"],
        "password": os.environ["ERP_PASS"],
    }).encode(),
    headers={"Content-Type": "application/x-www-form-urlencoded"},
)
token = json.load(urllib.request.urlopen(login, timeout=30))["access_token"]

limit, start, updated = 500, 0, 0
while True:
    req = urllib.request.Request(
        f"{base}/api/orders?limit={limit}&start={start}"
        "&order_by=modified_asc&include_aggregates=false",
        headers={"Authorization": f"Bearer {token}"},
    )
    rows = json.load(urllib.request.urlopen(req, timeout=60)).get("rows") or []
    pairs = [
        (r["name"], r["enrollment_number"].strip())
        for r in rows
        if r.get("name") and (r.get("enrollment_number") or "").strip()
    ]
    if pairs:
        def q(s):  # SQL string literal
            return "'" + s.replace("'", "''") + "'"
        values = ",".join(f"({q(n)},{q(e)})" for n, e in pairs)
        sql = (
            "UPDATE erp.sales_orders AS so SET student = v.enr "
            f"FROM (VALUES {values}) AS v(name, enr) "
            "WHERE so.erp_name = v.name AND (so.student IS NULL OR so.student = '') "
            "RETURNING so.erp_name;"
        )
        out = subprocess.run(
            ["psql", db, "-qtA", "-c", sql], capture_output=True, text=True, check=True
        )
        updated += len([l for l in out.stdout.splitlines() if l.strip()])
    print(f"  page start={start} rows={len(rows)} (updated so far: {updated})")
    if len(rows) < limit:
        break
    start += limit
print(f"  API sweep updated {updated} rows")
PY

echo "▶ Result:"
psql "$DB_URL" -c "
  SELECT count(*) AS total,
         count(*) FILTER (WHERE NULLIF(student,'') IS NOT NULL) AS with_enrollment
    FROM erp.sales_orders;" -c "
  SELECT erp_name, student FROM erp.sales_orders WHERE erp_name = 'SAL-ORD-2026-12050';"
echo "✓ Backfill complete"
