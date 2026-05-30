-- Admin RBAC — Phase 1: split nav:<page> permissions into
-- <page>.read + <page>.write, and add a per-user override layer.
--
-- Re-key strategy (preserves current effective access for the three system roles):
--   super-admin: every page → both .read and .write
--   operations:  every page → both .read and .write (matches today: ops could write)
--   school-admin: every page they had → .read only (matches today: read-mostly UX)
--
-- Custom roles created by super-admins also get expanded: every nav:<page>
-- row becomes <page>.read + <page>.write (preserving current behaviour where
-- "can see" implied "can do"). Admins who want read-only custom roles will
-- edit them after this migration.
--
-- The legacy `users.role` enum column is kept untouched; phase 2+ migrate
-- the ~315 routes still gated on it.

BEGIN;

-- 1. Expand every existing nav:<page> row into <page>.read + <page>.write.
--    INSERT ... SELECT then DELETE — done in one transaction so concurrent
--    reads see a consistent set.
INSERT INTO admin_role_permissions (role_id, permission)
SELECT role_id, substring(permission FROM 5) || '.read'
  FROM admin_role_permissions
 WHERE permission LIKE 'nav:%'
ON CONFLICT DO NOTHING;

-- Write rows: super-admin + ops + every custom role. NOT school-admin
-- (which was read-only by convention via isReadOnlyAdmin). After this
-- migration, "school-admin" has only .read keys and the role editor can
-- be used to grant specific .write keys if desired.
INSERT INTO admin_role_permissions (role_id, permission)
SELECT arp.role_id, substring(arp.permission FROM 5) || '.write'
  FROM admin_role_permissions arp
  JOIN admin_roles r ON r.id = arp.role_id
 WHERE arp.permission LIKE 'nav:%'
   AND r.slug <> 'school-admin'
ON CONFLICT DO NOTHING;

-- Drop the legacy nav:* rows.
DELETE FROM admin_role_permissions WHERE permission LIKE 'nav:%';

-- 2. Per-user override layer.
--    granted=true  → grant a permission this user's role does NOT have.
--    granted=false → revoke a permission this user's role DOES have.
--    The effective permission set = (role perms ∪ user grants) \ user revokes.
CREATE TABLE IF NOT EXISTS admin_user_permissions (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission   text NOT NULL,
  granted      boolean NOT NULL DEFAULT true,
  granted_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS admin_user_permissions_user_idx
  ON admin_user_permissions (user_id);

COMMIT;
