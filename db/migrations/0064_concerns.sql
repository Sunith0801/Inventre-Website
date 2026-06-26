-- 0064: Parent concern portal (inventre.in/portal)
--
-- Backs the call-centre concern flow: a parent raises a concern from the
-- portal (Order & Delivery / Payment Issues / Customer Care), it lands here,
-- and is pushed to the Audit call-centre Admin Panel (concern.created → audit
-- ingest). Status flips come back from audit, like exchange/missing.
--
-- Idempotent (CREATE … IF NOT EXISTS) so the file-based migrator can re-run.

CREATE TABLE IF NOT EXISTS concerns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concern_number  text UNIQUE,                       -- CON-2026-NNNNN (inventre-minted)
  parent_id       uuid REFERENCES parents(id),
  order_id        uuid REFERENCES orders(id),        -- nullable: not every concern is order-specific
  category        text NOT NULL,                     -- 'payment' | 'order_delivery' | 'customer_care'
  description     text,
  contact_phone   text,
  photos          jsonb,
  status          text NOT NULL DEFAULT 'open',      -- open | in_progress | resolved | rejected
  audit_ref       text,                              -- audit-side id once synced
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS concerns_parent_idx ON concerns (parent_id);
CREATE INDEX IF NOT EXISTS concerns_order_idx  ON concerns (order_id);
CREATE INDEX IF NOT EXISTS concerns_status_idx ON concerns (status);
