-- ════════════════════════════════════════════════════════════════════════
--  Inventre prod data fixes — companion to branch fix/shop-catalog-resolution
--
--  Run ONCE on the prod Postgres after merging the branch + redeploying the
--  app. Wraps three operations in a single transaction so you can review the
--  audit at the end before COMMIT (psql will auto-rollback on any error).
--
--  Touches only rows already known to be broken:
--    • Bundles whose base_price = 49900 (₹499) — the placeholder used at
--      import time. Repriced from sum-of-children where possible, archived
--      where empty.
--    • One product (SAS GRADE 10 BOOK KIT) misclassified as bundle_level=leaf.
--  Real prices, real components, and any bundle that already has a non-
--  placeholder price are NOT touched.
--
--  Reversible:
--    • Reprice rollback: snapshot the products table before running, OR
--      restore from the most-recent backups/inventre_full_*.sql dump.
--    • Status='archived' rollback: UPDATE products SET status='active'
--      WHERE base_price=49900 AND bundle_level IN ('magic_box','bookkit','sub_bundle')
--      (this resurrects every archived placeholder bundle; do not run unless
--      you intend to revert).
-- ════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- Fix #5 — mislabel correction
UPDATE products SET bundle_level='bookkit'
 WHERE name='SAS GRADE 10 BOOK KIT' AND bundle_level='leaf';

-- Fix #3a — recompute bundle prices from sum of component prices
WITH rollup AS (
  SELECT p.id,
    (SELECT SUM(child.base_price * bc.qty)
       FROM product_bundles pb
       JOIN bundle_components bc ON bc.bundle_id=pb.id
       LEFT JOIN products child ON child.id=bc.product_id
      WHERE pb.product_id=p.id)::int AS new_price
  FROM products p
  WHERE p.bundle_level IN ('magic_box','bookkit','sub_bundle')
    AND p.status='active'
    AND p.base_price = 49900
    AND EXISTS (
      SELECT 1 FROM product_bundles pb
      JOIN bundle_components bc ON bc.bundle_id=pb.id
      WHERE pb.product_id=p.id
    )
)
UPDATE products p SET base_price = rollup.new_price
  FROM rollup
 WHERE p.id = rollup.id
   AND rollup.new_price IS NOT NULL
   AND rollup.new_price > 0;

-- Fix #3b — archive bundles that have no components (unsafe to sell at ₹499)
UPDATE products p SET status='archived'
 WHERE p.bundle_level IN ('magic_box','bookkit','sub_bundle')
   AND p.status='active'
   AND p.base_price = 49900
   AND NOT EXISTS (
     SELECT 1 FROM product_bundles pb
     JOIN bundle_components bc ON bc.bundle_id=pb.id
     WHERE pb.product_id=p.id
   );

-- Audit — review before COMMIT
\echo
\echo '=========================== POST-FIX AUDIT ==========================='
SELECT
  COUNT(*) FILTER (WHERE bundle_level='magic_box' AND status='active')
    AS active_magic_boxes,
  COUNT(*) FILTER (WHERE bundle_level='magic_box' AND status='active' AND base_price=49900)
    AS magic_boxes_still_at_placeholder,
  COUNT(*) FILTER (WHERE bundle_level='bookkit' AND status='active')
    AS active_bookkits,
  COUNT(*) FILTER (WHERE bundle_level='bookkit' AND status='archived' AND base_price=49900)
    AS archived_empty_bookkits,
  COUNT(*) FILTER (WHERE bundle_level='sub_bundle' AND status='active')
    AS active_sub_bundles,
  COUNT(*) FILTER (WHERE bundle_level='leaf' AND status='active' AND base_price=49900)
    AS leaves_still_at_placeholder
FROM products;
\echo '======================================================================'
\echo 'Review the row above. If counts look sensible, type   COMMIT;'
\echo 'If anything looks wrong, type                          ROLLBACK;'
\echo 'Reasonable expected values on the local DB after running:'
\echo '  active_magic_boxes ~ 175,  magic_boxes_still_at_placeholder small (≤5)'
\echo '  active_bookkits    ~ 337,  archived_empty_bookkits   ~ 109'
\echo '  active_sub_bundles ~ 702,  leaves_still_at_placeholder ~ 703'
\echo '  (leaves are NOT touched by this script — those need BOM/ERP backfill.)'
\echo '======================================================================'

-- Either COMMIT or run as one shot (uncomment next line). Default: leave the
-- txn open so a human reviews the audit row before committing.
-- COMMIT;
