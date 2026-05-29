-- Links a variant product back to its template. Mirrors ERPNext's
-- "Variant Of" relationship. Templates get is_variant_item=false and
-- the column is null; variants get is_variant_item=true and the column
-- points at the template.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS variant_of_product_id uuid
    REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_variant_of_idx
  ON products(variant_of_product_id);
