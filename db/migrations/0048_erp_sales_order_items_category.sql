-- Per-line ERP category on the sales-order-items mirror.
--
-- ERP `/api/orders/{name}` returns a `category` ("bookkit" / "uniform" /
-- etc.) on every items row, but the mirror previously dropped it. The
-- customer "My Orders" detail page needs it so the per-category status
-- card can fall back to the *correct* shipment-level state when ERP has
-- not yet incremented per-line delivered_qty.
--
-- Before this column, a single in-transit bookkit shipment flipped the
-- order-wide fallback to "in_transit", which then painted every line
-- (including uniform lines with NO shipment) as "in transit". The fix
-- needs to look at each line's own ERP category against the per-category
-- shipment state.
--
-- Backfill: leave NULL. The poller's next tick re-pulls /api/orders/{name}
-- for any order that has been touched on audit; existing in-flight orders
-- will pick the column up as they're re-polled by scripts/repoll-stale-orders.

-- GUARDED, 2026-09-10. erp.sales_order_items belongs to the ERP mirror: no
-- migration in this directory creates it, and nothing in this repository
-- does either. On a live database it is always present and this runs exactly
-- as it always has. On an empty one — CI, or a rebuild from source — it is
-- absent, and an unguarded ALTER would abort the whole chain. See the note in
-- 0014_missing_pushed_tables.sql.
DO $$
BEGIN
  IF to_regclass('erp.sales_order_items') IS NULL THEN
    RAISE NOTICE '[0048] erp.sales_order_items absent (ERP mirror not present) - skipping';
    RETURN;
  END IF;

  ALTER TABLE erp.sales_order_items
    ADD COLUMN IF NOT EXISTS category text NULL;
END $$;
