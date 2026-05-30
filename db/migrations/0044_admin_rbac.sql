-- Admin RBAC — Phase A foundation.
--
-- Adds two tables (admin_roles, admin_role_permissions) and a role_id
-- column on the existing `users` table. Backfills three system roles
-- (super-admin / operations / school-admin) matching the legacy enum
-- so existing admins see no behavioural change.
--
-- The legacy `users.role` enum column is KEPT — the ~140 existing
-- `requireAdmin(...)` call sites continue to gate by it. New gates can
-- opt into permission-based checks via `requirePermission(...)`.

CREATE TABLE IF NOT EXISTS admin_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,
  name         text NOT NULL,
  description  text,
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role_id      uuid NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission   text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES admin_roles(id);

-- Seed the three system roles (idempotent — slug is the natural key).
INSERT INTO admin_roles (slug, name, description, is_system)
VALUES
  ('super-admin', 'Super Admin', 'Full access to every admin tab and action. Cannot be deleted; permission list is always all-on.', true),
  ('operations',  'Operations',  'Day-to-day operations: orders, shipments, students, catalog. No access to admin users, OTP/ERP system settings.', true),
  ('school-admin','School Admin','Scoped to a single school. Sees orders, students, returns, reports for their school only.', true)
ON CONFLICT (slug) DO NOTHING;

-- Seed permissions for each system role. Re-run safe — PRIMARY KEY de-dups.
-- super-admin gets every key listed below.
INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, p.perm FROM admin_roles r
CROSS JOIN (VALUES
  ('nav:dashboard'),
  ('nav:orders'), ('nav:shipments'), ('nav:invoices'), ('nav:returns'),
  ('nav:schools'), ('nav:grades'), ('nav:delivery-fees'),
  ('nav:customers'), ('nav:students'), ('nav:mcb'), ('nav:guardians'),
  ('nav:catalog'),
  ('nav:discounts'), ('nav:tax'),
  ('nav:suppliers'), ('nav:purchase-orders'),
  ('nav:payments'), ('nav:payments-ccavenue'),
  ('nav:reviews'), ('nav:testimonials'), ('nav:contact-forms'), ('nav:gift-cards'),
  ('nav:content'),
  ('nav:import'), ('nav:reports'), ('nav:activity'), ('nav:otp-logs'),
  ('nav:settings-users'), ('nav:settings-otp'), ('nav:settings-erp-bridge'),
  ('nav:roles')
) AS p(perm)
WHERE r.slug = 'super-admin'
ON CONFLICT DO NOTHING;

-- operations: all keys above EXCEPT super-only system surfaces.
INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, p.perm FROM admin_roles r
CROSS JOIN (VALUES
  ('nav:dashboard'),
  ('nav:orders'), ('nav:shipments'), ('nav:invoices'), ('nav:returns'),
  ('nav:schools'), ('nav:grades'), ('nav:delivery-fees'),
  ('nav:customers'), ('nav:students'), ('nav:mcb'), ('nav:guardians'),
  ('nav:catalog'),
  ('nav:discounts'), ('nav:tax'),
  ('nav:suppliers'), ('nav:purchase-orders'),
  ('nav:payments'), ('nav:payments-ccavenue'),
  ('nav:reviews'), ('nav:testimonials'), ('nav:contact-forms'), ('nav:gift-cards'),
  ('nav:content'),
  ('nav:import'), ('nav:reports'), ('nav:activity')
) AS p(perm)
WHERE r.slug = 'operations'
ON CONFLICT DO NOTHING;

-- school-admin: curated subset focused on their school's day-to-day.
INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, p.perm FROM admin_roles r
CROSS JOIN (VALUES
  ('nav:dashboard'),
  ('nav:orders'), ('nav:shipments'), ('nav:returns'),
  ('nav:students'),
  ('nav:reports')
) AS p(perm)
WHERE r.slug = 'school-admin'
ON CONFLICT DO NOTHING;

-- Backfill users.role_id from legacy enum column.
UPDATE users SET role_id = (SELECT id FROM admin_roles WHERE slug = 'super-admin') WHERE role = 'super'        AND role_id IS NULL;
UPDATE users SET role_id = (SELECT id FROM admin_roles WHERE slug = 'operations')  WHERE role = 'ops'          AND role_id IS NULL;
UPDATE users SET role_id = (SELECT id FROM admin_roles WHERE slug = 'school-admin')WHERE role = 'school_admin' AND role_id IS NULL;
