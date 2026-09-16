-- Only Super Admin is a system role. Every other role — including Operations
-- Manager, which was seeded as "system" — is a custom role the business owns:
-- it can be renamed, re-permissioned and, once nobody holds it, deleted from
-- the Roles page like any other.

UPDATE admin_roles SET is_system = (slug = 'super-admin');
