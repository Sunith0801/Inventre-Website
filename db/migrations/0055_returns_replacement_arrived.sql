-- 0055 — Customer-facing intermediate state: the warehouse's replacement
-- box has reached the school (2026-06-07)
--
-- Until now the customer-facing status page jumped straight from
-- "Approved · come to school on Sat" to "Completed". For multi-day
-- pickup windows the parent had no signal that the actual box had
-- arrived; if the warehouse was slow or the carrier delayed, the
-- parent might show up on Saturday to an empty school.
--
-- This timestamp is stamped by the audit-side webhook
-- exchange.replacement_arrived when the OutwardShipment for the
-- replacement leg flips to `delivered`. The customer page reads it
-- and renders a clearer "Your replacement has arrived at school"
-- callout between "approved" and the final "received" handover.

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS replacement_arrived_at timestamp with time zone;
