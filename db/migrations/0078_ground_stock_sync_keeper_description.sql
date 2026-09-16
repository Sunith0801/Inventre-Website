-- The audit's own name for the pile behind a size ("Black 10S Shoes"), so the
-- admin Ground Stock page can show shared General Merchandise the way the
-- audit does instead of by whichever school's product it landed on.
ALTER TABLE ground_stock_sync ADD COLUMN IF NOT EXISTS keeper_description text;
