-- Two admin changes (2026-09-15).
--
-- 1. PROCUREMENT IS GONE. Suppliers, purchase orders, receipts and purchase
--    invoices were built for an ERP-replacement that never happened: every
--    one of these tables is empty on production, buying lives in Zoho, and
--    the auto-PO cron only ever drafted into an empty module. The section,
--    its pages, APIs and tables are removed; payment entries and
--    communications lose their supplier / PO links.
--
-- 2. ONE PAYMENTS MODULE. "Payments" (the manual ledger) and "CCAvenue
--    Payment Logs" (gateway transactions) were two sidebar modules with two
--    permissions for one subject. They are now tabs of a single Payments
--    module under the `payments` permission; every `payments-ccavenue.*`
--    grant becomes the matching `payments.*` grant so nobody loses access.

-- ── 1. Procurement ────────────────────────────────────────────────────
ALTER TABLE payment_entries DROP COLUMN IF EXISTS supplier_id;
ALTER TABLE payment_entries DROP COLUMN IF EXISTS po_id;
ALTER TABLE communications  DROP COLUMN IF EXISTS supplier_id;

DROP TABLE IF EXISTS purchase_invoice_items;
DROP TABLE IF EXISTS purchase_invoices;
DROP TABLE IF EXISTS purchase_receipt_items;
DROP TABLE IF EXISTS purchase_receipts;
DROP TABLE IF EXISTS purchase_order_items;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS suppliers;

DROP TYPE IF EXISTS purchase_invoice_status;
DROP TYPE IF EXISTS purchase_order_status;
DROP TYPE IF EXISTS supplier_status;

DELETE FROM admin_role_permissions
 WHERE split_part(permission, '.', 1) IN ('suppliers', 'purchase-orders');
DELETE FROM admin_user_permissions
 WHERE split_part(permission, '.', 1) IN ('suppliers', 'purchase-orders');

-- ── 2. Payments ───────────────────────────────────────────────────────
INSERT INTO admin_role_permissions (role_id, permission)
SELECT role_id, 'payments.' || split_part(permission, '.', 2)
  FROM admin_role_permissions
 WHERE permission IN ('payments-ccavenue.read', 'payments-ccavenue.write')
ON CONFLICT DO NOTHING;

INSERT INTO admin_user_permissions (user_id, permission, granted, granted_by)
SELECT user_id, 'payments.' || split_part(permission, '.', 2), granted, granted_by
  FROM admin_user_permissions
 WHERE permission IN ('payments-ccavenue.read', 'payments-ccavenue.write')
ON CONFLICT DO NOTHING;

DELETE FROM admin_role_permissions WHERE permission IN ('payments-ccavenue.read', 'payments-ccavenue.write');
DELETE FROM admin_user_permissions WHERE permission IN ('payments-ccavenue.read', 'payments-ccavenue.write');
