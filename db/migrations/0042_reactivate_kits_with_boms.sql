-- 0042 — Reactivate kits with valid BOMs (2026-05-27)
--
-- 48 standalone kit products (is_variant_item=false) were sitting at
-- status='archived' despite carrying:
--   - at least one active product_variants row
--   - a product_bundles row + bundle_components
--   - a product_school link
--
-- The most common case is "SAS Suchitra Grade 12 MBPC" and similar
-- per-stream kits which never appear on the storefront because the
-- catalog query in lib/repos/products.ts filters status='active'.
-- An earlier import cycle archived them; subsequent BOM imports never
-- promoted them back because the importer only sets status on INSERT.
--
-- Fix: for every kit with a BOM and a school link, ensure status is
-- 'active'. Idempotent — subsequent runs match zero rows.

BEGIN;

UPDATE products p
   SET status = 'active'
 WHERE p.kind = 'kit'
   AND p.is_variant_item = false
   AND p.status = 'archived'
   AND EXISTS (SELECT 1 FROM product_bundles pb WHERE pb.product_id = p.id)
   AND EXISTS (SELECT 1 FROM product_variants v
                WHERE v.product_id = p.id AND v.is_active)
   AND EXISTS (SELECT 1 FROM product_school ps WHERE ps.product_id = p.id);

ANALYZE products;

COMMIT;
