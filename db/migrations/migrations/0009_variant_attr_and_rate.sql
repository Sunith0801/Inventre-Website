-- Variant selector metadata (Bookkit Hindi vs Kannada selector group + label)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS variant_attribute text,
  ADD COLUMN IF NOT EXISTS variant_attribute_value text;

-- Per-child price from BOM "Rate (Items)" so we can roll up variant pricing
-- (Bookkit Hindi MRP = sum of its bundle_components rates × qty, recursively).
-- Stored in paise so we match the existing money convention.
ALTER TABLE bundle_components
  ADD COLUMN IF NOT EXISTS rate_paise integer NOT NULL DEFAULT 0;
