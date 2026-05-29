-- Terms & Conditions acceptance audit columns. Captured at the very end
-- of first-time login (after OTP + password) so we know which version of
-- the policy each parent ticked through. NULL = never accepted (legacy
-- rows + parents created before this migration shipped).
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS tc_accepted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS tc_accepted_version text;
