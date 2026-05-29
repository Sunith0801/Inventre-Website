-- ERPNext-inspired modules: Suppliers, Purchase Orders, Purchase Receipts,
-- Payment Entries, Activity Log, Communications.

CREATE TYPE supplier_status AS ENUM ('active', 'on_hold', 'blocked');

CREATE TABLE suppliers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_code text NOT NULL,
  name text NOT NULL,
  contact_name text,
  phone text,
  email text,
  gstin text,
  pan text,
  address jsonb,
  payment_terms text,
  status supplier_status NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_code_idx ON suppliers(supplier_code);
CREATE INDEX suppliers_name_idx ON suppliers(name);

CREATE TYPE purchase_order_status AS ENUM (
  'draft', 'submitted', 'partially_received', 'received', 'cancelled'
);

CREATE TABLE purchase_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  po_number text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  status purchase_order_status NOT NULL DEFAULT 'draft',
  order_date date NOT NULL,
  expected_date date,
  subtotal integer NOT NULL DEFAULT 0,
  tax_total integer NOT NULL DEFAULT 0,
  grand_total integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX po_number_idx ON purchase_orders(po_number);
CREATE INDEX po_supplier_idx ON purchase_orders(supplier_id);
CREATE INDEX po_status_idx ON purchase_orders(status);

CREATE TABLE purchase_order_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id),
  description text NOT NULL,
  qty integer NOT NULL,
  received_qty integer NOT NULL DEFAULT 0,
  unit_price integer NOT NULL,
  total integer NOT NULL
);
CREATE INDEX po_items_po_idx ON purchase_order_items(po_id);

CREATE TABLE purchase_receipts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_number text NOT NULL,
  po_id uuid REFERENCES purchase_orders(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid
);
CREATE UNIQUE INDEX receipts_num_idx ON purchase_receipts(receipt_number);
CREATE INDEX receipts_po_idx ON purchase_receipts(po_id);

CREATE TABLE purchase_receipt_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  po_item_id uuid REFERENCES purchase_order_items(id),
  variant_id uuid REFERENCES product_variants(id),
  description text NOT NULL,
  qty integer NOT NULL
);
CREATE INDEX receipt_items_receipt_idx ON purchase_receipt_items(receipt_id);

CREATE TYPE payment_method AS ENUM (
  'cash', 'upi', 'card', 'netbanking', 'wallet', 'razorpay',
  'ccavenue', 'bank_transfer', 'cheque', 'other'
);
CREATE TYPE payment_direction AS ENUM ('received', 'paid');

CREATE TABLE payment_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_number text NOT NULL,
  direction payment_direction NOT NULL,
  method payment_method NOT NULL,
  amount integer NOT NULL,
  parent_id uuid REFERENCES parents(id),
  supplier_id uuid REFERENCES suppliers(id),
  invoice_id uuid REFERENCES invoices(id),
  order_id uuid REFERENCES orders(id),
  po_id uuid REFERENCES purchase_orders(id),
  reference_number text,
  payment_date date NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_entries_num_idx ON payment_entries(payment_number);
CREATE INDEX payment_entries_parent_idx ON payment_entries(parent_id);
CREATE INDEX payment_entries_invoice_idx ON payment_entries(invoice_id);

CREATE TABLE activity_log (
  id bigserial PRIMARY KEY,
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  summary text,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_actor_idx ON activity_log(actor_id);
CREATE INDEX activity_log_entity_idx ON activity_log(entity_type, entity_id);
CREATE INDEX activity_log_created_idx ON activity_log(created_at);

CREATE TYPE communication_kind AS ENUM ('call', 'sms', 'email', 'whatsapp', 'note');

CREATE TABLE communications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id uuid REFERENCES parents(id),
  supplier_id uuid REFERENCES suppliers(id),
  kind communication_kind NOT NULL,
  subject text,
  body text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comms_parent_idx ON communications(parent_id);
CREATE INDEX comms_supplier_idx ON communications(supplier_id);
CREATE INDEX comms_occurred_idx ON communications(occurred_at);
