-- The admin "Raise exchange" flow (/admin/exchanges/new + POST /api/admin/exchanges)
-- was removed along with admin-created shipments and returns: exchanges are
-- raised by parents on the storefront and handled in ERPNext. The permission
-- that gated it no longer points at anything, so drop its grants.

DELETE FROM admin_role_permissions
 WHERE permission IN ('spoc-exchange.read', 'spoc-exchange.write');

DELETE FROM admin_user_permissions
 WHERE permission IN ('spoc-exchange.read', 'spoc-exchange.write');
