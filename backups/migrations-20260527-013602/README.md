# Migration snapshot — 2026-05-27 01:36 IST (full deploy bundle)

Snapshot of every migration on branch `wip/2026-05-27-coupon-codes`,
including the catalog data backfill (0037).

## Contents

| File | Bytes | What it does |
|---|---:|---|
| `0034_perf_and_delivery_fee_defaults.sql` | 2.2 KB | Partial index on `orders.erp_so_name` + pre-seed Books default rule per active school |
| `0035_data_fixes_2026_05_26.sql` | 7.1 KB | Variant reactivation, new-student backfill, Book Set → kit, kit variant size dedup, kind reclassification, grade tags for KLINK/QLPHP/SAMYU, size_chart_url repoint |
| `0036_orders_coupon_id_and_audit_join.sql` | 2.3 KB | `orders.coupon_id` reservation column + partial index + backfill from `website_cart_coupon_usages` |
| `0037_catalog_data_backfill.sql` | **3.6 MB** | INSERT … ON CONFLICT DO NOTHING for every row in `schools`, `categories`, `product_attributes`, `product_attribute_values`, `products`, `product_variants`, `product_grades`, `product_images`. Closes the gap where the production cutover dump was missing items the local dev DB had backfilled from ERPNext (e.g. Kidlink Blazer, SAS Sports Track) |

Combined: 3.8 MB across 4 files.

## Why 0037 exists

The 2026-05-26 production cutover dump shipped without ~handful of
catalog rows that the local dev DB had since fetched from ERPNext.
Migrations 0034 / 0035 / 0036 carried schema fixes + idempotent
UPDATE/ON-CONFLICT statements, but they never INSERTED the missing
product rows themselves. So after the deploy, the admin catalog on
production still didn't show items like "Kidlink Blazer" or
"SAS Sports Track".

0037 is the gap closer: a pg_dump --data-only --inserts
--on-conflict-do-nothing of the eight catalog tables from the local DB.
Production rows with the same UUID (or matching unique key) are left
untouched; only truly-missing rows get inserted. Excluded from the
dump: `orders`, `payments`, `students`, `parents`, `addresses`,
`inventory_ledger` — those are tenant-specific and must come from the
production cutover dump, never from a developer's DB.

## Deploy path

Normal: do nothing. `db/migrate.ts` picks up `0037_catalog_data_backfill.sql`
on the next prod boot, applies it under the `__schema_migrations`
ledger, and stamps it so it never re-runs.

Manual replay (rare — DBA / ops ticket):
```bash
cd backups/migrations-20260527-013602
for f in 0034_*.sql 0035_*.sql 0036_*.sql 0037_*.sql; do
  docker exec -i inventre-postgres psql -U inventre -d inventre -1 < "$f"
done
```

## Post-replay scripts (still required)

These compute derived state and must run on the target host after the
SQL applies:

```bash
npx tsx scripts/classify-products.ts
npx tsx scripts/backfill-grades-from-bom.ts
npx tsx scripts/dedupe-guardians.ts
```
