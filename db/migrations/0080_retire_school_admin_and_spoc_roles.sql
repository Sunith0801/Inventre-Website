-- Retire the "School Admin" and "School SPOC" system roles (2026-09-15).
--
-- The staff hierarchy has ONE school-side role, "School". The two older
-- school roles were kept only because the create-user endpoint mapped the
-- legacy `school_admin` account type onto "School Admin"; that mapping now
-- points at "School" (see app/api/admin/users), so nothing needs them.
--
-- Nobody loses access: "School" receives every grant either retired role
-- held, and their users move across. Deleting the roles cascades their
-- grant rows (admin_role_permissions.role_id ON DELETE CASCADE).

INSERT INTO admin_role_permissions (role_id, permission)
SELECT school.id, rp.permission
  FROM admin_roles school
  JOIN admin_roles old ON old.slug IN ('school-admin', 'spoc')
  JOIN admin_role_permissions rp ON rp.role_id = old.id
 WHERE school.slug = 'school'
ON CONFLICT DO NOTHING;

UPDATE users
   SET role_id = (SELECT id FROM admin_roles WHERE slug = 'school')
 WHERE role_id IN (SELECT id FROM admin_roles WHERE slug IN ('school-admin', 'spoc'));

-- A school-side account with a school is scoped to it: the legacy
-- `school_admin` account type is what every order/student/report query keys
-- its school filter on. One without a school is left as it is — flipping it
-- would fail closed and hide everything.
UPDATE users
   SET role = 'school_admin'
 WHERE role_id = (SELECT id FROM admin_roles WHERE slug = 'school')
   AND school_id IS NOT NULL
   AND role <> 'school_admin';

DELETE FROM admin_roles WHERE slug IN ('school-admin', 'spoc');
