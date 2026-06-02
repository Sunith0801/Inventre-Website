-- 0049 — Auto-insert a Standard variant when a kit product is created or promoted (2026-06-02)
--
-- Every kit product needs one row in product_variants for storefront
-- add-to-cart to resolve (/api/shop/variant looks up by size='Standard').
-- Historically this was maintained by ad-hoc runs of
-- scripts/backfill-kit-variants.ts after new kits landed; missing the
-- backfill leaves the storefront BuyBox showing "Size not available".
--
-- This trigger closes the gap at the data layer: any time a row in
-- products transitions to (kind='kit', status='active') without a
-- matching active variant, an Standard variant is auto-created using
-- the same shape the backfill script writes:
--   size='Standard', sku=<product.slug>, stock_qty=0, is_active=true,
--   erp_name=NULL.
--
-- Collision-safe: if another product_variants row already has the slug
-- as its SKU (UNIQUE index), the trigger silently skips — same policy as
-- the backfill script. The kit will simply remain in the "needs manual
-- attention" set and a re-run of the backfill (with a unique sku
-- fallback) handles it.

BEGIN;

CREATE OR REPLACE FUNCTION ensure_kit_variant() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'kit' AND NEW.status = 'active' THEN
    IF NOT EXISTS (
      SELECT 1 FROM product_variants pv
       WHERE pv.product_id = NEW.id AND pv.is_active = true
    ) AND NOT EXISTS (
      SELECT 1 FROM product_variants pv WHERE pv.sku = NEW.slug
    ) THEN
      INSERT INTO product_variants (product_id, size, sku, stock_qty, is_active)
      VALUES (NEW.id, 'Standard', NEW.slug, 0, true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_ensure_kit_variant ON products;
CREATE TRIGGER products_ensure_kit_variant
  AFTER INSERT OR UPDATE OF kind, status ON products
  FOR EACH ROW
  EXECUTE FUNCTION ensure_kit_variant();

COMMIT;
