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

ALTER TABLE erp.sales_order_items
  ADD COLUMN IF NOT EXISTS category text NULL;
