-- Exchange / Missing window override (2026-09-26). Admins can re-open the
-- 7-day post-delivery request window for a specific order (exception cases
-- recommended by the school). `returns_override_until` is the exclusive
-- cut-off instant (IST midnight after the chosen last day); NULL = no
-- override. Who / when / why are kept for the audit trail.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returns_override_until timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returns_override_note text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returns_override_by text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returns_override_at timestamptz;
