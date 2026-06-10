-- 0056 — Missing-item claims (2026-06-07)
--
-- Different from exchanges: customer NEVER received the item.
-- No reverse logistics (nothing to return); just a fresh dispatch from
-- warehouse to school. State machine simpler:
--   requested → approved → received_at_school → delivered
--   requested → rejected (terminal)
--
-- ID format: MIS-YYYY-NNNNN. Allocated by lib/numbering.allocClaimNumber.
-- Phone-gated via the same EXCHANGE_TESTER_PHONES allowlist for now.

CREATE TABLE IF NOT EXISTS missing_item_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Customer-facing reference (MIS-YYYY-NNNNN). Unique once written.
  claim_number text UNIQUE,
  order_id uuid NOT NULL REFERENCES orders(id),
  parent_id uuid NOT NULL REFERENCES parents(id),
  -- Status — kept as text to mirror returns.status convention. Valid:
  --   requested | approved | rejected | received_at_school | delivered
  status text NOT NULL DEFAULT 'requested',
  notes text,
  rejection_reason text,
  -- Customer-facing intermediate state (mirrors returns.replacement_arrived_at).
  -- Stamped when the warehouse → school dispatch lands.
  replacement_arrived_at timestamptz,
  pickup_date date,
  -- Photos the customer attached (photos of what WAS delivered so CC
  -- can verify against the order). Same shape as returns.photos.
  photos jsonb,
  approved_at timestamptz,
  approved_by uuid,
  rejected_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_missing_claims_parent_status ON missing_item_claims(parent_id, status);
CREATE INDEX IF NOT EXISTS ix_missing_claims_order ON missing_item_claims(order_id);

CREATE TABLE IF NOT EXISTS missing_item_claim_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES missing_item_claims(id) ON DELETE CASCADE,
  -- Which order line is short. Multiple items per claim possible.
  order_item_id uuid NOT NULL,
  qty_short integer NOT NULL,
  -- For kit/Magic-Box claims where only a component is missing.
  -- {variantId, componentName, attributes} — same shape as
  -- returns.requested_component_path. The bridge enriches with
  -- item_code/item_name before sending to audit.
  missing_component_path jsonb,
  notes text
);
CREATE INDEX IF NOT EXISTS ix_missing_claim_items_claim ON missing_item_claim_items(claim_id);
