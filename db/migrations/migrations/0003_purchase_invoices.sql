-- Purchase Invoice (supplier-side bill) — counterpart to customer sales_invoices.
-- Idempotent: safe to re-run.

DO $$ BEGIN
  CREATE TYPE purchase_invoice_status AS ENUM (
    'draft', 'submitted', 'paid', 'partly_paid', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number           TEXT NOT NULL,
  supplier_invoice_number  TEXT,
  supplier_invoice_date    DATE,
  supplier_id              UUID NOT NULL REFERENCES suppliers(id),
  po_id                    UUID REFERENCES purchase_orders(id),
  receipt_id               UUID REFERENCES purchase_receipts(id),
  posting_date             DATE NOT NULL,
  due_date                 DATE,
  subtotal                 INTEGER NOT NULL DEFAULT 0,
  tax_total                INTEGER NOT NULL DEFAULT 0,
  grand_total              INTEGER NOT NULL DEFAULT 0,
  outstanding_amount       INTEGER NOT NULL DEFAULT 0,
  status                   purchase_invoice_status NOT NULL DEFAULT 'draft',
  notes                    TEXT,
  created_by               UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_num_idx
  ON purchase_invoices (invoice_number);
CREATE INDEX IF NOT EXISTS purchase_invoices_supplier_idx
  ON purchase_invoices (supplier_id);
CREATE INDEX IF NOT EXISTS purchase_invoices_status_idx
  ON purchase_invoices (status);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  po_item_id    UUID REFERENCES purchase_order_items(id),
  variant_id    UUID REFERENCES product_variants(id),
  description   TEXT NOT NULL,
  qty           INTEGER NOT NULL,
  unit_price    INTEGER NOT NULL,
  tax_amount    INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS purchase_invoice_items_inv_idx
  ON purchase_invoice_items (invoice_id);

-- Seed numbering counter prefix for purchase invoices (PIN-{FY}-NNNNN)
-- (uses the existing numbering_counters mechanism; no action needed here)

-- Mode of Payment master
CREATE TABLE IF NOT EXISTS modes_of_payment (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS modes_of_payment_code_idx
  ON modes_of_payment (code);

-- Seed default modes if empty
INSERT INTO modes_of_payment (code, name, type, sort_order)
SELECT * FROM (VALUES
  ('cash',          'Cash',           'cash',    1),
  ('upi',           'UPI',            'bank',    2),
  ('card',          'Card',           'gateway', 3),
  ('netbanking',    'Net banking',    'bank',    4),
  ('bank_transfer', 'Bank transfer',  'bank',    5),
  ('cheque',        'Cheque',         'bank',    6),
  ('razorpay',      'Razorpay',       'gateway', 7),
  ('ccavenue',      'CCAvenue',       'gateway', 8),
  ('other',         'Other',          'cash',    9)
) AS v(code, name, type, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM modes_of_payment);

-- Customer Group master
CREATE TABLE IF NOT EXISTS customer_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_groups_code_idx
  ON customer_groups (code);

INSERT INTO customer_groups (code, name, description, sort_order)
SELECT * FROM (VALUES
  ('student',    'Student',    'Parent buying for one or more students', 1),
  ('school',     'School',     'School itself purchasing in bulk',       2),
  ('individual', 'Individual', 'Walk-in / one-off customer',             3)
) AS v(code, name, description, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM customer_groups);

-- Notification rules
CREATE TABLE IF NOT EXISTS notification_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  channel         TEXT NOT NULL,
  recipient_type  TEXT NOT NULL,
  template_id     TEXT,
  subject         TEXT,
  body_template   TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_rules_event_idx
  ON notification_rules (event_type, enabled);

-- Outbound webhook endpoints
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  secret            TEXT NOT NULL,
  events            TEXT[] NOT NULL DEFAULT '{}',
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  last_delivery_at  TIMESTAMPTZ,
  last_status       INTEGER,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Outbound webhook deliveries (history + retry queue)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  endpoint_id     UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          INTEGER,
  response_body   TEXT,
  attempt         INTEGER NOT NULL DEFAULT 1,
  next_retry_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx
  ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_retry_idx
  ON webhook_deliveries (next_retry_at)
  WHERE status IS NULL OR status >= 400;

-- e-Way Bill columns on shipments
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS ewaybill_number TEXT,
  ADD COLUMN IF NOT EXISTS ewaybill_status TEXT,
  ADD COLUMN IF NOT EXISTS ewaybill_valid_upto TIMESTAMPTZ;
