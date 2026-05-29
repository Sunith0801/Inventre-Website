-- Shop catalog data fixes (one-off, idempotent).
-- Companion to the listProductsForStudent code fixes in lib/repos/products.ts
-- (merged via PR #8, branch fix/shop-catalog-resolution).
--
-- Three operations:
--   1. SAS GRADE 10 BOOK KIT was tagged bundle_level='leaf' but is a bookkit —
--      flip it so the catalog router treats it correctly.
--   2. Bundles still at the ₹499 (49900 paise) import-time placeholder are
--      repriced from sum-of-children where their component graph is intact.
--      Leaves are not touched — their real prices come from BOM/ERP, not
--      from a rollup.
--   3. Bundles still at ₹499 AND with no bundle_components are unsafe to
--      sell (customer pays ₹499 for an empty bundle) — archived so the
--      shop hides them until admin links real components. Reversible by
--      UPDATE products SET status='active' WHERE id=...
--
-- Idempotent: every predicate filters on the placeholder signature
-- (base_price=49900 / status='active' / specific name), so a second run is
-- a no-op even if migrate.ts somehow re-applied this file outside its
-- normal tracking table.

-- 1) Mislabel correction
UPDATE products
   SET bundle_level = 'bookkit'
 WHERE name = 'SAS GRADE 10 BOOK KIT'
   AND bundle_level = 'leaf';

-- 2) Reprice placeholder bundles from sum-of-children.
-- Iterates because bundles can contain other bundles: a sub_bundle whose
-- children are themselves placeholder sub_bundles can only roll up *after*
-- those children are repriced. Three passes is enough for the bundle depth
-- in this catalog (Magic Box → Bookkit → Sub_bundle → leaf). Each pass is
-- idempotent — once a bundle is off ₹499 it's outside the WHERE filter.
DO $$
BEGIN
  FOR i IN 1..3 LOOP
    WITH rollup AS (
      SELECT p.id,
             (SELECT SUM(child.base_price * bc.qty)
                FROM product_bundles pb
                JOIN bundle_components bc ON bc.bundle_id = pb.id
           LEFT JOIN products child ON child.id = bc.product_id
               WHERE pb.product_id = p.id)::int AS new_price
        FROM products p
       WHERE p.bundle_level IN ('magic_box', 'bookkit', 'sub_bundle')
         AND p.status = 'active'
         AND p.base_price = 49900
         AND EXISTS (
           SELECT 1
             FROM product_bundles pb
             JOIN bundle_components bc ON bc.bundle_id = pb.id
            WHERE pb.product_id = p.id
         )
    )
    UPDATE products p
       SET base_price = rollup.new_price
      FROM rollup
     WHERE p.id = rollup.id
       AND rollup.new_price IS NOT NULL
       AND rollup.new_price > 0;
  END LOOP;
END $$;

-- 3) Archive empty placeholder bundles
UPDATE products p
   SET status = 'archived'
 WHERE p.bundle_level IN ('magic_box', 'bookkit', 'sub_bundle')
   AND p.status = 'active'
   AND p.base_price = 49900
   AND NOT EXISTS (
     SELECT 1
       FROM product_bundles pb
       JOIN bundle_components bc ON bc.bundle_id = pb.id
      WHERE pb.product_id = p.id
   );
