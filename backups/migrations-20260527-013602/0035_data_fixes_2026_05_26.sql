-- 0035 — Production data fixes batch (2026-05-26)
--
-- Captures the one-off DB UPDATEs/INSERTs that were applied to the local
-- dev database during the 2026-05-26 admin batch so production sees the
-- same state after deploy. Every statement is idempotent (filtered, no
-- ON CONFLICT errors, never writes when target is already correct) so
-- the migration is safe to re-run.
--
-- Pairs with two TypeScript scripts that must be run after deploy to
-- catch the parts that require external data — these scripts are
-- committed alongside this migration:
--
--   1) npx tsx scripts/classify-products.ts                — sets bundle_level
--   2) npx tsx scripts/backfill-grades-from-bom.ts         — derives grade
--      tags + product_school links from Magic Box/Bookkit BOMs
--   3) npx tsx scripts/dedupe-guardians.ts                 — merges
--      guardians.mobile_number duplicates into one canonical row
--
-- The SQL below handles the bits that don't have a script: variant
-- reactivation, new-student rule backfill, product kind + size fixes,
-- size_chart_url rewrites.

-- ── 1. Reactivate every bundle-class product_variant ─────────────────
-- The earlier dump/backfill had silently soft-deleted 175 variants of
-- products with kind in (kit, sub_bundle, magic_box, bookkit). Those
-- bundle variants should never be inactive: the cart drops inactive
-- variants on read (lib/repos/cart.ts:214-222), and any SMS Annual Kit
-- in the wild would auto-vanish from a parent's cart on next refresh.
UPDATE product_variants pv
   SET is_active = true
  FROM products p
 WHERE pv.product_id = p.id
   AND p.kind::text IN ('kit','sub_bundle','magic_box','bookkit')
   AND pv.is_active = false;

-- ── 2. Auto-mark new students (non-CAS + enrolment "26*") ────────────
-- Ops rule: enrolment beginning with "26" + school_code NOT starting
-- with "CAS" → new admit, routed to the Magic Box catalog. Same
-- predicate the admin grant action (app/admin/(protected)/mcb/actions.ts)
-- now applies on every fresh grant; this UPDATE catches the existing
-- rows that pre-date the rule.
UPDATE students
   SET is_new_student = true
 WHERE enrollment_number LIKE '26%'
   AND school_code IS NOT NULL
   AND school_code NOT LIKE 'CAS%'
   AND is_new_student = false;

-- ── 3. Reclassify "Book Set" products as kit ─────────────────────────
-- classify-products.ts only sees products whose name contains "Bookkit",
-- "Magic Box", or "Bundle N". "Book Set" was missing from the regex, so
-- ~17 Book Set products were typed as `kind=uniform` and didn't route
-- to the multi-axis picker. Fix them in place.
UPDATE products
   SET kind = 'kit'::product_kind
 WHERE name ILIKE '%book set%'
   AND kind::text = 'uniform';

-- ── 4. Variant dedup for kit-class products ─────────────────────────
-- Many kit variants shared the same `size` value (e.g. "SAS Suchitra
-- Grade 11 Mandate" appeared on 38 rows). Object.fromEntries(...) in
-- app/shop/[id]/page.tsx collapsed duplicates and every combo showed the
-- last variant's price. Force unique sizes by promoting `sku` (already
-- unique) into the `size` column for any variant that has a duplicate.
UPDATE product_variants pv
   SET size = pv.sku
  FROM products p
 WHERE pv.product_id = p.id
   AND p.kind::text IN ('kit','sub_bundle','magic_box','bookkit')
   AND EXISTS (
     SELECT 1 FROM product_variants pv2
      WHERE pv2.product_id = pv.product_id
        AND pv2.size = pv.size
        AND pv2.id <> pv.id
   );

-- ── 5. Product-kind misclassification cleanup ───────────────────────
-- Items that should obviously be uniforms/accessories were typed as
-- `book` by an earlier import. The catalog-page query filters
-- kind NOT IN ('magic_box','book','sub_bundle'), so these were invisible
-- in every school's storefront. Patch by item_code (set on import).
UPDATE products SET kind = 'uniform'::product_kind WHERE item_code IN (
  'KLS Waist Coat', 'QLS Blazer', 'QLS PP RNT', 'SAM Sports RNT',
  'SAM Tights', 'BATA SHOES', 'NIVIA SHOES', 'SAS SHOES', 'WINMORE SHOES',
  'QLS Bow Tie', 'SMS Maroon T-Shirt', 'SMS Pri Skort',
  'WM WF Sports RNT', 'WM WF Tights'
);
UPDATE products SET kind = 'accessory'::product_kind WHERE item_code IN (
  'CRIMSON BAGS', 'INVENTRE BAGS'
);

-- ── 6. Direct grade tagging for KLINK / QLPHP / SAMYU uniforms ──────
-- These three schools have no Magic Box / Bookkit BOMs in our catalog,
-- so backfill-grades-from-bom.ts can't infer their uniform grades. Apply
-- the grade ranges the user picked. Idempotent via ON CONFLICT DO NOTHING
-- on the (product_id, grade) unique constraint.
DO $$
DECLARE
  rec RECORD;
  g TEXT;
BEGIN
  FOR rec IN (
    SELECT 'KLS Waist Coat'       AS item, ARRAY['Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'] AS grades
    UNION ALL SELECT 'QLS Blazer',           ARRAY['Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12','Grade 13']
    UNION ALL SELECT 'QLS PP RNT',           ARRAY['Grade 1','Grade 2','Grade 3']
    UNION ALL SELECT 'SAM Sports RNT',       ARRAY['Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12','Grade 13']
    UNION ALL SELECT 'SAM Tights',           ARRAY['Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12','Grade 13']
    UNION ALL SELECT 'SAMYU BAGS',           ARRAY['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12','Grade 13']
    UNION ALL SELECT 'SAMYU BATA SHOES',     ARRAY['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12','Grade 13']
    UNION ALL SELECT 'SAMYU NIVIA SHOES',    ARRAY['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12','Grade 13']
    UNION ALL SELECT 'SAMYU PP WATERBOTTLE', ARRAY['Grade 1','Grade 2','Grade 3']
  ) LOOP
    FOREACH g IN ARRAY rec.grades LOOP
      INSERT INTO product_grades (product_id, grade)
      SELECT id, g FROM products WHERE item_code = rec.item
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END
$$;

-- ── 7. Repoint broken size-chart URLs to ERP's still-public /files/ ──
-- 104 products had `size_chart_url` like "/files/Track pant size guide.jpg"
-- which 404s locally. The original ERPNext host (erp.inventre.in) still
-- serves them publicly; rewrite the path so the storefront PDP renders
-- the size chart. Future imports should be updated to absolutise URLs.
UPDATE products
   SET size_chart_url = 'https://erp.inventre.in' || size_chart_url
 WHERE size_chart_url LIKE '/files/%';

-- ── 8. Re-analyze affected tables so the planner sees the new shape ──
ANALYZE product_variants;
ANALYZE products;
ANALYZE students;
ANALYZE product_grades;
