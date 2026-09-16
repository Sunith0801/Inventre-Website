-- The manual payment ledger is its own Finance module again ("Manual
-- Entries"), separate from the CCAvenue gateway log ("Payments"). New key
-- `payment-entries.*`; everyone who holds `payments.*` gets the matching
-- grant so the split changes nobody's access.

INSERT INTO admin_role_permissions (role_id, permission)
SELECT role_id, 'payment-entries.' || split_part(permission, '.', 2)
  FROM admin_role_permissions
 WHERE permission IN ('payments.read', 'payments.write')
ON CONFLICT DO NOTHING;

INSERT INTO admin_user_permissions (user_id, permission, granted, granted_by)
SELECT user_id, 'payment-entries.' || split_part(permission, '.', 2), granted, granted_by
  FROM admin_user_permissions
 WHERE permission IN ('payments.read', 'payments.write')
ON CONFLICT DO NOTHING;
