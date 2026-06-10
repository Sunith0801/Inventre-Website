-- 0054 — Persist the rejection_reason that audit customer-care types
-- (2026-06-07)
--
-- Before this column, when audit rejected an exchange the customer just
-- saw a generic "we couldn't approve this — contact support" with no
-- explanation. The reason was captured on the audit side but never sent
-- across the webhook, never persisted on inventre, never displayed.
--
-- This column closes the chain: audit's exchange_publish sends it in
-- the envelope, inventre's webhook receiver persists it here, and the
-- customer-facing /shop/orders/[id]/exchange/[returnId] page renders
-- it inside the "Not approved" callout.
--
-- Nullable — historic rejected rows pre-this column read NULL and the
-- UI falls back to the original generic text.

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS rejection_reason text;
