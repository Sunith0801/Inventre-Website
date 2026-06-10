-- 0053 — Honest replacement_mode on `returns` (2026-06-07)
--
-- The Phase-2 form silently assumed "same fresh piece" for damaged /
-- defective. Customers couldn't say "actually, I want a different size
-- instead, since this one's damaged". This column captures the
-- customer's explicit choice so the audit-side UI never has to guess:
--
--   'sibling'             — picked a different size/variant (requested_variant_id set)
--   'same_fresh'          — explicitly wants a fresh copy of the same variant
--   'different_describe'  — wants something different (description in notes)
--
-- Nullable so any historic rows pre-this-column simply read NULL and
-- the audit UI falls back to its old inference.

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS replacement_mode text;
