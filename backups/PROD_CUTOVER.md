# First production cutover

This folder contains a one-shot dev-DB dump that seeds production with
everything we've built locally — products, BOM hierarchy, attribute
groups, students, guardians, schools, UOMs, barcodes — without re-running
the eleven backfill scripts on the prod box.

## What's in the dump

`inventre-prod-cutover-YYYYMMDD-HHMM.sql.gz` (~10 MB compressed,
~62 MB uncompressed).

| Included | Counts (at dump time) |
|---|---|
| Schema (CREATE TABLE, CREATE TYPE, INDEX, CONSTRAINT) | All tables |
| `products` | 2 630 |
| `product_variants` (size SKUs) | 5 880 |
| `product_bundles` | 1 281 |
| `bundle_components` (with `rate_paise`) | 7 923 |
| `bundle_configs` (school+grade → magic_box) | 183 |
| `product_school` | 3 928 |
| `product_grades` | 6 111 |
| `product_uoms` | 2 592 |
| `product_barcodes` | 3 |
| `schools` | 19 |
| `students` | 20 553 |
| `guardians` | 16 969 |
| `parents` | 1 (test parent; safe to drop or keep) |

| Excluded (by design — start prod clean) |
|---|
| `__schema_migrations` (prod's migrator recreates it; the bootstrap
fingerprint check marks 0000-0005 applied and runs 0006-0012 fresh) |
| `cart_items`, `orders`, `order_items`, `invoices`, `invoice_items`,
`payments` (transactional data — should be empty on cutover) |

## Cutover sequence

1. **Push code** (already done):
   ```
   git push origin main  # 4687a1d
   ```

2. **Deploy** the new image. The entrypoint runs `db/migrate.js`
   which applies migrations 0006-0012 in order. Verify the boot log
   shows `[migrate]   ✓ 0006_bundle_level.sql` … `0012_country_customs.sql`.

3. **Stop the prod app** (so no writes happen during restore):
   ```
   docker compose stop web        # or your equivalent
   ```

4. **Restore the dump**. On the prod host:
   ```
   gunzip -c inventre-prod-cutover-YYYYMMDD-HHMM.sql.gz \
     | psql "$DATABASE_DIRECT_URL"
   ```
   (Use the direct DSN, not the PgBouncer one — DDL needs a
   session-pinned connection.)

   You'll see "relation already exists" warnings for tables that the
   migrator already created — that's expected. The `COPY` blocks load
   the data.

5. **Restart the app**:
   ```
   docker compose start web
   ```

6. **Smoke test** — log in as a known parent (e.g. phone
   `9347162216`, password `123456` if you set one) and check:
   - `/shop` shows the right items for the right grade/gender
   - `/admin/products/<id>` shows hierarchy + logistics panels populated
   - Cart / checkout still resolve

## Rolling back

If anything goes wrong, the cutover is reversible because nothing is
destroyed — the `INSERT` statements in the dump fail loudly on conflicts
rather than overwriting. If you need to roll back:

```
docker compose stop web
# restore the prod-side snapshot taken before step 4
```

Always take a `pg_dump` of prod immediately before step 4 as a safety net.

## Going forward (after the cutover)

- **Schema changes** → add `db/migrations/NNNN_*.sql`, commit, deploy.
  The entrypoint applies them automatically.
- **Catalog data refresh** → ERP feed cron + admin panel edits.
  Re-running the backfill scripts on prod is only needed when you
  re-import the BOM.csv / Item.csv from ERPNext — they're idempotent
  (`ON CONFLICT DO NOTHING` / `COALESCE`).
