-- Marks products that are variant SKUs (size/color sub-items) rather than
-- main templates. The shop hides these; checkout still uses them via
-- product_variants when wired up properly.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_variant_item boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS products_is_variant_item_idx
  ON products(is_variant_item)
 WHERE is_variant_item = false;
