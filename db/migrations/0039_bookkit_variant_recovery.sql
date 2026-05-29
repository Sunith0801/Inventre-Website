-- 0039 — Bookkit variant recovery (2026-05-27)
--
-- BOM.csv ships language/stream variants of each Bookkit as concatenated
-- suffixes ("SMS Grade 6 BookkitHindi 2nd Lan Tel 3rd Lan"). An earlier
-- import path created these as standalone products without linking them
-- to the template Bookkit. The PDP fell back to "Kit contents are being
-- updated. Check back soon." because the template had no variants and
-- no BOM.
--
-- scripts/import-bom-csv.ts now writes these links correctly. This
-- migration normalises any pre-existing rows so the importer reaches a
-- clean steady state. The fixes mirror the patterns from
-- 0035 (admin batch 2026-05-26):
--
--   1. Reactivate every bundle-class product_variant — cart and PDP
--      both filter by is_active=true, so a soft-deleted bundle variant
--      vanishes from the storefront.
--   2. Promote sku → size for rows whose size strips the "Bookkit"
--      word — lib/bookkit-langs.ts:parseBookkitLangs needs that token
--      to detect language pairs.
--   3. Variant dedup for kit-class products (same predicate as 0035 §4).
--
-- Every statement is idempotent: subsequent runs match zero rows.

BEGIN;

-- ── 1. Reactivate every bundle-class product_variant ─────────────────
UPDATE product_variants pv
   SET is_active = true
  FROM products p
 WHERE pv.product_id = p.id
   AND p.kind::text IN ('kit','sub_bundle','magic_box','bookkit')
   AND pv.is_active = false;

-- ── 2. Promote sku → size for bundle-variant rows whose size lacks ──
--     the literal "Bookkit" word.
UPDATE product_variants pv
   SET size = pv.sku
  FROM products p
 WHERE pv.product_id = p.id
   AND p.kind::text IN ('kit','sub_bundle','magic_box','bookkit')
   AND pv.size !~* 'bookkit'
   AND pv.sku   ~* 'bookkit';

-- ── 3. Variant dedup for kit-class products ─────────────────────────
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

-- ── 4. Re-analyze affected tables ────────────────────────────────────
ANALYZE product_variants;
ANALYZE product_grades;
ANALYZE products;

COMMIT;
