-- Three staff tiers, replacing "everyone senior is a Super Admin".
--
-- Before this, three accounts held Super Admin — which includes Roles &
-- permissions, so any of them could grant themselves or anyone else anything,
-- and one of the three (admin@inventre.in) is a shared mailbox whose actions
-- cannot be traced to a person.
--
-- The line drawn here:
--
--   Super Admin        runs the business AND controls access + system config
--   Admin              runs the business, cannot change who has access
--   Operations Manager operational work only
--
-- So Admin gets everything Super Admin has EXCEPT four families:
--   roles.*                 granting permissions — the escalation path
--   settings-users.*        creating and resetting staff accounts
--   settings-otp.*          holds the toggle that turns every parent login
--                           into a fixed bypass code (see the OTP request
--                           route) — not something a business admin needs
--   settings-erp-bridge.*   replay and queue surgery against the ERP
--
-- Derived from super-admin's grants rather than listed literally, so a future
-- migration that adds a page permission to super-admin gives it to Admin too
-- and cannot silently leave Admin behind.

-- 1. The Admin role. Idempotent: the row may already exist.
INSERT INTO admin_roles (slug, name)
VALUES ('admin', 'Admin')
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint

-- 2. Its permissions, mirrored from super-admin minus the four families above.
INSERT INTO admin_role_permissions (role_id, permission)
SELECT target.id, src.permission
  FROM admin_roles target
  CROSS JOIN (
    SELECT DISTINCT rp.permission
      FROM admin_role_permissions rp
      JOIN admin_roles r ON r.id = rp.role_id
     WHERE r.slug = 'super-admin'
  ) src
 WHERE target.slug = 'admin'
   AND src.permission NOT LIKE 'roles.%'
   AND src.permission NOT LIKE 'settings-users.%'
   AND src.permission NOT LIKE 'settings-otp.%'
   AND src.permission NOT LIKE 'settings-erp-bridge.%'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 3. "Operations" becomes "Operations Manager".
--
-- A RENAME, deliberately, not a new role. All six people on it keep the exact
-- permissions they have today — including the 44 per-user overrides somebody
-- tuned by hand (Amrit holds 13 sections, Abhijith 5). Creating a fresh role
-- and moving everyone onto it would have flattened that tuning and changed
-- what six people can do on a working day.
UPDATE admin_roles SET name = 'Operations Manager' WHERE slug = 'operations';
