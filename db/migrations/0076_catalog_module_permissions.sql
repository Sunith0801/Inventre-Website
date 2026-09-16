-- Catalog becomes nine permissions instead of one.
--
-- "Catalog" was a single row in Roles & permissions that silently covered
-- four directories, 21 pages and 32 API routes: Products, BOMs, Categories,
-- Attributes, Bundles, the Build wizards, Pricing, School setup and Stock.
-- Granting a stock clerk the ability to adjust stock meant granting them the
-- ability to rewrite every product and price list. Each of those is now its
-- own key:
--
--   products.*            catalog-attributes.*   catalog-pricing.*
--   boms.*                catalog-bundles.*      catalog-setup.*
--   categories.*          catalog-build.*        catalog-stock.*
--
-- `catalog.*` stays, as the hub page (/admin/catalog) and the preview.
--
-- ── Rollout: expand → migrate → contract ─────────────────────────────────
-- This is the MIGRATE step. The code shipped alongside it is the EXPAND step:
-- every module gate accepts its own key OR `catalog.*`, so an environment
-- where this file has not run yet keeps working exactly as before. A later
-- CONTRACT step removes the `catalog.*` fallback from the gates once every
-- environment has this data. Splitting a live permission any other way
-- produces a window in which staff are locked out of pages they used
-- yesterday.
--
-- ── Nothing changes for anyone on the day this runs ──────────────────────
-- Every role that holds `catalog.read` gets `<module>.read` for all nine
-- modules; likewise write. Every per-user override — grant OR revoke — on
-- `catalog.*` is copied onto the nine module keys with the same sign. The
-- effective permission set of every account is therefore identical before
-- and after. Narrowing is a decision an administrator makes afterwards, on
-- the Roles screen, one module at a time.
--
-- Idempotent throughout: every insert is ON CONFLICT DO NOTHING.

-- 1. Roles: fan `catalog.read` / `catalog.write` out onto the module keys.
INSERT INTO admin_role_permissions (role_id, permission)
SELECT rp.role_id,
       m.slug || '.' || split_part(rp.permission, '.', 2)
  FROM admin_role_permissions rp
 CROSS JOIN (VALUES
   ('products'), ('boms'), ('categories'),
   ('catalog-attributes'), ('catalog-bundles'), ('catalog-build'),
   ('catalog-pricing'), ('catalog-setup'), ('catalog-stock')
 ) AS m(slug)
 WHERE rp.permission IN ('catalog.read', 'catalog.write')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 2. Per-user overrides: same fan-out, preserving whether each was a grant
--    or a revoke. A user who was explicitly denied Catalog stays denied every
--    module; one who was explicitly granted it keeps every module.
INSERT INTO admin_user_permissions (user_id, permission, granted, granted_by)
SELECT up.user_id,
       m.slug || '.' || split_part(up.permission, '.', 2),
       up.granted,
       up.granted_by
  FROM admin_user_permissions up
 CROSS JOIN (VALUES
   ('products'), ('boms'), ('categories'),
   ('catalog-attributes'), ('catalog-bundles'), ('catalog-build'),
   ('catalog-pricing'), ('catalog-setup'), ('catalog-stock')
 ) AS m(slug)
 WHERE up.permission IN ('catalog.read', 'catalog.write')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 3. Super Admin and Admin hold every key in the registry by definition, so
--    they get all eighteen whether or not they happened to hold `catalog.*`.
--    (Nothing in this codebase grants a new key to Super Admin automatically —
--    it is four keys short of the registry today for exactly that reason.)
INSERT INTO admin_role_permissions (role_id, permission)
SELECT r.id, k.permission
  FROM admin_roles r
 CROSS JOIN (VALUES
   ('products.read'),           ('products.write'),
   ('boms.read'),               ('boms.write'),
   ('categories.read'),         ('categories.write'),
   ('catalog-attributes.read'), ('catalog-attributes.write'),
   ('catalog-bundles.read'),    ('catalog-bundles.write'),
   ('catalog-build.read'),      ('catalog-build.write'),
   ('catalog-pricing.read'),    ('catalog-pricing.write'),
   ('catalog-setup.read'),      ('catalog-setup.write'),
   ('catalog-stock.read'),      ('catalog-stock.write')
 ) AS k(permission)
 WHERE r.slug IN ('super-admin', 'admin')
ON CONFLICT DO NOTHING;
