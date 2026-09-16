-- Ground Stock bridge, second source: the audit's "Ground Stock (New)" page
-- (keeper-SKU stock). Each synced variant now records which keeper SKU its
-- figure came from and which audit page supplied it, so the admin Ground
-- Stock page can show the pile behind every size.

ALTER TABLE ground_stock_sync ADD COLUMN IF NOT EXISTS keeper_sku text;
ALTER TABLE ground_stock_sync ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ground_stock';
