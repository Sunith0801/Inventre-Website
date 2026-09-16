-- Three more staff roles, requested 2026-09-15 alongside Admin / Operations /
-- School / Customer care, which already exist.
--
--   Warehouse  fulfilment floor: sees orders, works shipments, returns and stock,
--              can look up purchase orders and suppliers for incoming goods.
--   Category   catalogue owners: the whole Catalog family (products, BOMs,
--              categories, attributes, bundles, build, pricing, school setup)
--              plus read-only stock.
--   Sales      order desk: orders, customers, students, guardians, discounts,
--              exchanges; read-only on schools, grades, invoices, payments,
--              returns and reports.
--
-- Grants are the starting point; Roles & permissions edits them from the UI.

INSERT INTO admin_roles (slug, name, description)
VALUES
  ('warehouse', 'Warehouse', 'Fulfilment: shipments, returns and stock.'),
  ('category',  'Category',  'Catalogue: products, bundles, pricing and school setup.'),
  ('sales',     'Sales',     'Order desk: orders, customers, students and discounts.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, k.permission
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('dashboard.read'),
   ('orders.read'),
   ('shipments.read'),       ('shipments.write'),
   ('returns.read'),         ('returns.write'),
   ('catalog-stock.read'),   ('catalog-stock.write'),
   ('purchase-orders.read'),
   ('suppliers.read')
 ) AS k(permission)
 WHERE r.slug = 'warehouse'
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, k.permission
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('dashboard.read'),
   ('catalog.read'),            ('catalog.write'),
   ('products.read'),           ('products.write'),
   ('boms.read'),               ('boms.write'),
   ('categories.read'),         ('categories.write'),
   ('catalog-attributes.read'), ('catalog-attributes.write'),
   ('catalog-bundles.read'),    ('catalog-bundles.write'),
   ('catalog-build.read'),      ('catalog-build.write'),
   ('catalog-pricing.read'),    ('catalog-pricing.write'),
   ('catalog-setup.read'),      ('catalog-setup.write'),
   ('catalog-stock.read')
 ) AS k(permission)
 WHERE r.slug = 'category'
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, k.permission
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('dashboard.read'),
   ('orders.read'),        ('orders.write'),
   ('customers.read'),     ('customers.write'),
   ('students.read'),      ('students.write'),
   ('guardians.read'),     ('guardians.write'),
   ('discounts.read'),     ('discounts.write'),
   ('spoc-exchange.read'), ('spoc-exchange.write'),
   ('schools.read'),
   ('grades.read'),
   ('invoices.read'),
   ('payments.read'),
   ('returns.read'),
   ('reports.read')
 ) AS k(permission)
 WHERE r.slug = 'sales'
ON CONFLICT DO NOTHING;
