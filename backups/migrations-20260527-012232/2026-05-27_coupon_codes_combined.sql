-- =====================================================================
-- Inventre — Combined production migration bundle
-- Captured: 2026-05-27 01:22 IST
-- Source branch: wip/2026-05-27-coupon-codes
-- Includes every schema/data change from the 2026-05-26 admin batch +
-- the 2026-05-27 coupon-codes batch:
--
--   db/migrations/0034_perf_and_delivery_fee_defaults.sql
--   db/migrations/0035_data_fixes_2026_05_26.sql
--   db/migrations/0036_orders_coupon_id_and_audit_join.sql
--
-- The repo migrator (db/migrate.ts) applies each file individually on
-- deploy via the `__schema_migrations` ledger — this combined file is a
-- manual fallback (rollback reference, ad-hoc psql replay, DBA ticket
-- attachment). Do NOT add it to db/migrations/; doing so would re-run
-- the statements outside the migrator's bookkeeping. Every statement
-- below is idempotent (filtered WHERE, ON CONFLICT DO NOTHING, IF NOT
-- EXISTS), so manual replay is safe.
--
-- Usage (manual replay):
--     docker exec -i inventre-postgres \
--       psql -U inventre -d inventre < this-file.sql
--
-- Three scripts compute derived state and must be run after the SQL
-- lands. They live in scripts/ in the same branch:
--
--     npx tsx scripts/classify-products.ts
--     npx tsx scripts/backfill-grades-from-bom.ts
--     npx tsx scripts/dedupe-guardians.ts
-- =====================================================================


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0034 — Performance index + delivery-fee dashboard seed           ║
-- ╚═══════════════════════════════════════════════════════════════════╝

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


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0035 — Production data fixes batch (2026-05-26)                  ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- ── 1. Reactivate every bundle-class product_variant ─────────────────
UPDATE product_variants pv
   SET is_active = true
  FROM products p
 WHERE pv.product_id = p.id
   AND p.kind::text IN ('kit','sub_bundle','magic_box','bookkit')
   AND pv.is_active = false;

-- ── 2. Auto-mark new students (non-CAS + enrolment "26*") ────────────
UPDATE students
   SET is_new_student = true
 WHERE enrollment_number LIKE '26%'
   AND school_code IS NOT NULL
   AND school_code NOT LIKE 'CAS%'
   AND is_new_student = false;

-- ── 3. Reclassify "Book Set" products as kit ─────────────────────────
UPDATE products
   SET kind = 'kit'::product_kind
 WHERE name ILIKE '%book set%'
   AND kind::text = 'uniform';

-- ── 4. Variant dedup for kit-class products ─────────────────────────
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
UPDATE products
   SET size_chart_url = 'https://erp.inventre.in' || size_chart_url
 WHERE size_chart_url LIKE '/files/%';

-- ── 8. Re-analyze affected tables so the planner sees the new shape ──
ANALYZE product_variants;
ANALYZE products;
ANALYZE students;
ANALYZE product_grades;


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  0036 — orders.coupon_id + audit-table backfill (2026-05-27)      ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
-- The coupon-codes batch moved usage recording from order placement to
-- payment success, so a failed CCAvenue payment no longer burns a one-
-- time coupon. The new orders.coupon_id column reserves the coupon at
-- placement; lib/ccavenue-finalize.ts promotes the reservation to a
-- website_cart_coupon_usages row only when the payment finalises as
-- paid. The reserve-on-placement validator (apply-coupon route) blocks
-- a second parent from applying the same one-time code while another
-- order is mid-checkout (30-minute window).

-- ── 1. Add the reservation column ────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid
    REFERENCES website_cart_coupons(id) ON DELETE SET NULL;

-- ── 2. Partial index on the populated rows ───────────────────────────
CREATE INDEX IF NOT EXISTS orders_coupon_id_idx
  ON orders (coupon_id) WHERE coupon_id IS NOT NULL;

-- ── 3. Backfill from existing usages so the audit join keeps working ─
UPDATE orders o
   SET coupon_id = u.coupon_id
  FROM website_cart_coupon_usages u
 WHERE u.order_id = o.id
   AND o.coupon_id IS NULL;

ANALYZE orders;

-- =====================================================================
-- END OF BUNDLE
-- =====================================================================
