-- The audit's category ("Shoes", "Full Pants", "Textbook") and group
-- ("General Merchandise", "Uniforms", "Books") behind each synced size, so the
-- admin Ground Stock page can consolidate by standard (keeper) SKU and shelf
-- the way the audit's Ground Stock (New) page does.
ALTER TABLE ground_stock_sync ADD COLUMN IF NOT EXISTS keeper_category text;
ALTER TABLE ground_stock_sync ADD COLUMN IF NOT EXISTS keeper_group text;
