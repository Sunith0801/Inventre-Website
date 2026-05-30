-- Phase 2 prep: school-admin needs read/write keys that 0046 didn't seed.
--
-- 0046 assumed school-admin was read-only across the board. In reality
-- the legacy `requireAdmin("super", "ops", "school_admin")` (or `("super",
-- "school_admin")`) gate on several routes lets school-admin POST/PATCH
-- today — and several GETs sit outside the seeded nav set entirely
-- (e.g. /api/admin/products, /api/admin/reports/sales). Without these
-- rows, switching the routes to `requirePermission(...)` would lock the
-- school-admin out of work they do every day.
--
-- Reads added: customers, invoices, catalog
-- Writes added: orders, students
-- (Keys for routes school-admin never used, e.g. shipments.write, are
--  intentionally NOT added.)

BEGIN;

INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, p.perm FROM admin_roles r
CROSS JOIN (VALUES
  ('customers.read'),
  ('invoices.read'),
  ('catalog.read'),
  ('orders.write'),
  ('students.write')
) AS p(perm)
WHERE r.slug = 'school-admin'
ON CONFLICT DO NOTHING;

COMMIT;
