-- Order-confirmation notification log (SMS + email), one row per send
-- attempt. Backs the /admin/order-notifications dashboard and the
-- idempotency guard in lib/order-confirmation.ts (a 'sent' row for an
-- (order, channel) pair suppresses re-sends from the admin status-PATCH
-- path). Resend inserts a fresh row with attempt+1 — rows are never
-- updated in place, so the dashboard shows the full attempt history.
--
-- Re-run safe: IF NOT EXISTS everywhere, permission insert de-dups on PK.

BEGIN;

CREATE TABLE IF NOT EXISTS order_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_number text NOT NULL,
  channel      text NOT NULL,                        -- 'sms' | 'email'
  kind         text NOT NULL DEFAULT 'order_confirmed',
  recipient    text NOT NULL,                        -- phone or email ('' when missing)
  subject      text,                                 -- email only
  body         text,                                 -- exact SMS text / email text body
  status       text NOT NULL,                        -- 'sent' | 'failed'
  vendor_id    text,                                 -- SMS transactionId / SMTP messageId
  error        text,
  attempt      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_notifications_order_idx
  ON order_notifications(order_id);
CREATE INDEX IF NOT EXISTS order_notifications_created_idx
  ON order_notifications(created_at);

-- Dashboard access for the two system roles that hold every other ops slug.
INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, p.perm
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('order-notifications.read'),
   ('order-notifications.write')
 ) AS p(perm)
 WHERE r.slug IN ('super-admin', 'operations')
ON CONFLICT DO NOTHING;

COMMIT;
