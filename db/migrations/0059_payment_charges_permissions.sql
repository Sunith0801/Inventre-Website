-- Grant the new "Payment charges" admin page (slug: payment-charges) to the
-- two system roles that already hold every other Pricing & Tax slug:
--   super-admin → read + write
--   operations  → read + write
-- school-admin is left without grants (matches its baseline read-mostly UX —
-- super-admins can hand-grant if a particular school needs it).
--
-- Re-run safe: composite PK on (role_id, permission) de-dups.

BEGIN;

INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, p.perm
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('payment-charges.read'),
   ('payment-charges.write')
 ) AS p(perm)
 WHERE r.slug IN ('super-admin', 'operations')
ON CONFLICT DO NOTHING;

COMMIT;
