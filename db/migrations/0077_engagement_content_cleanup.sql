-- Engagement & Content clean-up (2026-09-15).
--
-- 1. The parent concern portal (inventre.in/portal) and its admin module
--    "Support Cases (Parent Concerns)" are removed. Inquiries (contact forms)
--    and Product Reviews remain the customer-facing intake. The two tables
--    behind it go with the code — nothing reads them any more.
--
-- 2. Testimonials are no longer a module of their own: they are homepage
--    copy, edited from Pages & Content Blocks, so they now sit under the
--    `content` permission. The `testimonials.*` keys leave the registry
--    (lib/admin-permissions.ts) and are removed from every role and every
--    per-user override. Anyone who could edit testimonials before is a
--    content editor now — those roles hold `content.*` already.
--
-- 3. Who sees what in this section:
--      Pages & Content Blocks  → Super Admin, Admin   (they hold content.*;
--                                 Admin via 0075's copy of Super Admin)
--      Inquiries, Reviews      → Customer care, in addition to the two above.

DROP TABLE IF EXISTS concern_messages;
DROP TABLE IF EXISTS concerns;

DELETE FROM admin_role_permissions WHERE permission IN ('testimonials.read', 'testimonials.write');
DELETE FROM admin_user_permissions WHERE permission IN ('testimonials.read', 'testimonials.write');

INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, k.permission
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('contact-forms.read'), ('contact-forms.write'),
   ('reviews.read'),       ('reviews.write')
 ) AS k(permission)
 WHERE r.slug = 'customer-care'
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, k.permission
  FROM admin_roles r
 CROSS JOIN (VALUES ('content.read'), ('content.write')) AS k(permission)
 WHERE r.slug IN ('super-admin', 'admin')
ON CONFLICT DO NOTHING;
