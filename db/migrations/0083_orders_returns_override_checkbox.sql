-- Exchange / Missing override becomes a simple per-order checkbox
-- (2026-09-26, same day as 0082): admin ticks "allow requests" and the
-- storefront buttons come back until it is unticked. The 7-day rule itself
-- is unchanged. The date column from 0082 is dropped (never used in prod).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returns_override_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE orders DROP COLUMN IF EXISTS returns_override_until;
