-- Master data captured from Item.csv child tables that wasn't previously
-- persisted. Both keyed by product_id so admin can list per-product.

CREATE TABLE IF NOT EXISTS product_uoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  uom text NOT NULL,
  conversion_factor numeric(12,4) NOT NULL DEFAULT 1,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, uom)
);
CREATE INDEX IF NOT EXISTS product_uoms_product_idx ON product_uoms(product_id);

CREATE TABLE IF NOT EXISTS product_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  barcode_type text,
  uom text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, barcode)
);
CREATE INDEX IF NOT EXISTS product_barcodes_product_idx ON product_barcodes(product_id);
CREATE INDEX IF NOT EXISTS product_barcodes_code_idx ON product_barcodes(barcode);
