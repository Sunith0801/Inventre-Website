-- Adds BOM-hierarchy classification to products.
--
-- bundle_level: where the product sits in the recursive BOM tree.
-- bundle_gender: only meaningful for magic_box rows (Boys/Girls variants).
--
-- Both are nullable; back-filled by scripts/classify-products.ts.

DO $$ BEGIN
  CREATE TYPE bundle_level AS ENUM ('magic_box','bookkit','sub_bundle','leaf');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS bundle_level bundle_level,
  ADD COLUMN IF NOT EXISTS bundle_gender text;

CREATE INDEX IF NOT EXISTS products_bundle_level_idx ON products(bundle_level);
