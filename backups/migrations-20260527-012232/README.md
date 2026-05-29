# Migration bundle — 2026-05-27 01:22 IST (coupon-codes batch)

Snapshot of every migration on branch `wip/2026-05-27-coupon-codes`.

## Contents

| File | Source migration files |
|---|---|
| `2026-05-27_coupon_codes_combined.sql` | `0034_perf_and_delivery_fee_defaults.sql` + `0035_data_fixes_2026_05_26.sql` + `0036_orders_coupon_id_and_audit_join.sql` |

## What's new vs the previous bundle (`migrations-20260527-000518`)

- Adds **0036** — `orders.coupon_id` reservation column + partial index +
  backfill from `website_cart_coupon_usages.order_id`. This is the
  schema half of the coupon pay-on-success behaviour.

The code half (move `recordCouponUsage` into `lib/ccavenue-finalize.ts`,
extend the apply-coupon validator with reserve-on-placement, bulk
generate + bulk extend dialogs, enriched audit drill-down) ships with
the application code on the same branch.

## When to use this folder

Normal deploy path: **don't**. The repo's `db/migrate.ts` runs each
migration file under the `__schema_migrations` ledger and stamps it so
it only runs once. Applying this combined file outside the migrator
re-executes the statements without updating the ledger (still safe —
every statement is idempotent — but wasteful).

Reach for this bundle only when:

- You need to hand a DBA / ops team a single SQL artefact attached to a
  ticket.
- You're rolling state into a brand-new database from a clean dump and
  want one paste instead of running three files.
- You're rebuilding from scratch and the migrations table is unavailable.

## Manual replay

```bash
docker exec -i inventre-postgres \
  psql -U inventre -d inventre < 2026-05-27_coupon_codes_combined.sql
```

## Post-replay scripts (still required)

```bash
npx tsx scripts/classify-products.ts
npx tsx scripts/backfill-grades-from-bom.ts
npx tsx scripts/dedupe-guardians.ts
```
