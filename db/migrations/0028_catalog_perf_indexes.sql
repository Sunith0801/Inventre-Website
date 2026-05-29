-- Catalog performance: speed up the recursive CTE in
-- listProductsForStudent (lib/repos/products.ts) that subtracts
-- bundle-contained products from the visible catalog. The existing
-- bundle_components_bundle_idx is keyed (bundle_id, selector_group_key) —
-- helpful for the bundle-id side of joins, useless when descending from
-- a parent product down through `bc.product_id`. The recursive step
-- (`JOIN bundle_components bc ON bc.bundle_id = pb.id` then matching
-- `bc.product_id`) does an index lookup on bundle_id first, but the
-- DISTINCT/UNION aggregation back to product_id was a seq scan.
--
-- Partial index since many bundle_components rows are variant-only
-- (product_id NULL) — those don't matter for catalog visibility.
CREATE INDEX IF NOT EXISTS bundle_components_product_idx
  ON bundle_components(product_id)
  WHERE product_id IS NOT NULL;
