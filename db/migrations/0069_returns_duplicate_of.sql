-- 0069 (2026-07-08): duplicate-of provenance for exchange rejections.
--
-- When audit rejects an exchange because the same item is already being
-- exchanged on another request, the exchange.rejected webhook now carries
-- a `duplicate_of` array naming the other RTN(s) and who raised each
-- ("team" = our support team on the customer's behalf, "customer" = the
-- parent). Persist it so the customer's status page can point them at the
-- request that already exists instead of a vague "duplicate" message.
--
-- Shape: [{ "return_number": "RTN-2026-01337", "status": "approved",
--           "raised_by": "team" }]
-- NULL on non-duplicate rejections and on rows predating this column.

ALTER TABLE returns ADD COLUMN IF NOT EXISTS duplicate_of jsonb;
