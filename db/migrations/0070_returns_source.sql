-- Track WHO raised each exchange / missing request so the storefront
-- duplicate-guard popup can say "…by the Customer Care Team" when the
-- existing request was raised in the Audit portal (Condition 4).
--   "customer"  — raised on the Inventre storefront (default).
--   "care_team" — raised in Audit by Customer Care, synced in via
--                 createExchangeFromAudit / createMissingFromAudit.
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'customer';

ALTER TABLE missing_item_claims
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'customer';
