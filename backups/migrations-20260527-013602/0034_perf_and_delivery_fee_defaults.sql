-- 0034 — Performance index + delivery-fee dashboard seed (2026-05-26)
--
-- Two parts, both idempotent so the migration can be re-run safely:
--
-- 1) PERFORMANCE — `orders.erp_so_name` was used in several admin-page
--    UNION CTEs (notably /admin/shipments, /admin/orders) to resolve
--    ERP-mirror shipment/packing-unit rows back to the local order's
--    UUID. The column had NO index, so the per-row correlated
--    subquery `(SELECT lo.id FROM orders lo WHERE lo.erp_so_name = ...)`
--    was forced into a Seq Scan of 16k rows for every probe — full
--    admin/shipments load was 42 s in dev. The partial index makes it
--    an index seek and cuts the page to <200 ms.
--
--    (There's already a `orders_erp_so_name_idx` UNIQUE index on a
--    DIFFERENT column — `erp_sales_order_name` — which is always NULL
--    in our data. The new index is on the column actually populated.)
--
-- 2) DELIVERY-FEE BOOKS DEFAULT — one row per active school in
--    `delivery_fee_rules` with applicable_item_groups = ["Books"] and
--    delivery_fee = 0. Surfaces in /admin/delivery-fee-rules so an
--    admin can later raise the per-school Books fee without first
--    figuring out that the row doesn't exist. The rule name is
--    deterministic (`DFR-BOOKS-{school_code}`) so the INSERT is
--    safely idempotent via `ON CONFLICT (name) DO NOTHING`.

-- ── Part 1: performance index ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS orders_erp_so_name_lookup_idx
  ON orders (erp_so_name)
  WHERE erp_so_name IS NOT NULL;

-- ── Part 2: pre-seed Books defaults per active school ────────────────
INSERT INTO delivery_fee_rules
  (name, school, applicable_item_groups, delivery_fee, min_amount, max_amount, is_active)
SELECT
  'DFR-BOOKS-' || s.school_code,
  s.erp_name,
  '["Books"]'::jsonb,
  0, 0, 0, true
FROM schools s
WHERE s.status = 'active'
  AND s.erp_name IS NOT NULL
  AND s.school_code IS NOT NULL
ON CONFLICT (name) DO NOTHING;

-- ── Part 3: refresh planner stats for the new index ──────────────────
ANALYZE orders;
