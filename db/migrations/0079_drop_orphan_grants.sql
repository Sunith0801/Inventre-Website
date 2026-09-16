-- Remove grants for pages that no longer exist. The Roles page flagged them
-- as "4 stale" on Super Admin and Admin:
--
--   gift-cards.*        the Gift Cards module was removed in the admin redesign
--   settings-api-keys.* the API-keys settings page no longer exists
--
-- A grant nobody can point at a page for is noise in an access review, and the
-- role editor already refuses to carry them into a duplicated role.

DELETE FROM admin_role_permissions
 WHERE permission IN ('gift-cards.read', 'gift-cards.write',
                      'settings-api-keys.read', 'settings-api-keys.write');

DELETE FROM admin_user_permissions
 WHERE permission IN ('gift-cards.read', 'gift-cards.write',
                      'settings-api-keys.read', 'settings-api-keys.write');
