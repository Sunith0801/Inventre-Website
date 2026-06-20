-- Grant the new SPOC "Raise Exchange" admin page (slug: spoc-exchange) so a
-- school SPOC can register exchanges on behalf of parents.
--   super-admin  → read + write
--   operations   → read + write
--   school-admin → read + write
--
-- Unlike most pages, school-admin DOES get write here: SPOCs ARE school-admins
-- and raising the exchange is the whole point. The per-school confinement is
-- enforced in the API (app/api/admin/exchanges/route.ts → assertSchoolAccess),
-- NOT by withholding the permission.
--
-- Re-run safe: composite PK on (role_id, permission) de-dups. No explicit
-- BEGIN/COMMIT — the file-based migrator (db/migrate.ts) already wraps each
-- migration in its own transaction.

INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, p.perm
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('spoc-exchange.read'),
   ('spoc-exchange.write')
 ) AS p(perm)
 WHERE r.slug IN ('super-admin', 'operations', 'school-admin')
ON CONFLICT DO NOTHING;
