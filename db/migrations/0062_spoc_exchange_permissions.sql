-- SPOC "Raise Exchange" capability (admin page slug: spoc-exchange).
--
-- A SPOC must be able to raise exchanges on behalf of parents, scoped to their
-- own school — but NOTHING else. So we DON'T bundle it onto `school-admin`
-- (which also holds orders.write / students.write); instead we mint a dedicated
-- minimal `spoc` role. Per-school confinement is enforced in the API
-- (app/api/admin/exchanges/route.ts → assertSchoolAccess, which gates on the
-- legacy users.role = 'school_admin' + users.school_id). So a SPOC user =
--   legacy users.role 'school_admin'  +  role_id -> 'spoc'  +  school_id set.
--
-- super-admin + operations also get spoc-exchange (global staff / call-centre
-- central logging — intentionally unscoped, same as their other powers).
--
-- Re-run safe: slug is the natural key; (role_id, permission) PK de-dups. No
-- explicit BEGIN/COMMIT — db/migrate.ts wraps each migration in a transaction.

-- 1. Dedicated minimal SPOC role.
INSERT INTO admin_roles (slug, name, description, is_system)
VALUES (
  'spoc',
  'School SPOC',
  'School single-point-of-contact. Can ONLY raise exchanges on behalf of parents, scoped to their own school. No order/student write access.',
  true
)
ON CONFLICT (slug) DO NOTHING;

-- 2. Minimal permission set for the spoc role: raise exchanges + the reads
--    needed to find an order and see the resulting request. NO orders.write,
--    NO students.write.
INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, p.perm
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('spoc-exchange.read'),
   ('spoc-exchange.write'),
   ('orders.read'),
   ('returns.read')
 ) AS p(perm)
 WHERE r.slug = 'spoc'
ON CONFLICT DO NOTHING;

-- 3. Global staff also get the exchange capability (unscoped by design).
INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, p.perm
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('spoc-exchange.read'),
   ('spoc-exchange.write')
 ) AS p(perm)
 WHERE r.slug IN ('super-admin', 'operations')
ON CONFLICT DO NOTHING;
