-- 0040 — Bookkit duplicate template resolve (2026-05-27)
--
-- Seven Bookkit template products exist twice in `products` — one row
-- created by an earlier ERP sync (status='active', no BOM linkage) and
-- a second row from the BOM importer with an auto-suffixed slug
-- (status='draft', carries the language-variant product_variants rows).
-- The storefront filters by status='active', so parents land on the
-- empty row and see "Kit contents are being updated. Check back soon."
--
-- Fix: for each duplicate-name kit, promote the variant-bearing row to
-- status='active' and archive the empty original. The variant-bearing
-- row keeps its existing slug — URL ugliness (e.g. "-rr" suffix) is
-- acceptable; what matters is that the parent's PDP renders contents.
--
-- Idempotent: subsequent runs match zero rows (the variant-bearing row
-- is already active, the empty row already archived).

BEGIN;

WITH dup_groups AS (
  SELECT name
    FROM products
   WHERE kind = 'kit' AND name ILIKE '%Bookkit%'
   GROUP BY name
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT
    p.id,
    p.name,
    p.status::text AS status_text,
    (SELECT COUNT(*)
       FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active) AS active_variants
    FROM products p
   WHERE p.kind = 'kit'
     AND p.name IN (SELECT name FROM dup_groups)
),
pairs AS (
  -- Keep = row with most active variants; tie-break by status='active'
  --        (so we don't archive a row that orders already reference).
  SELECT
    name,
    (ARRAY_AGG(id ORDER BY active_variants DESC,
                          CASE WHEN status_text='active' THEN 0 ELSE 1 END))[1]
      AS keep_id,
    (ARRAY_AGG(id ORDER BY active_variants ASC,
                          CASE WHEN status_text='active' THEN 1 ELSE 0 END))[1]
      AS archive_id
  FROM ranked
  GROUP BY name
)
SELECT * INTO TEMP TABLE _dup_pairs FROM pairs;

-- Promote the variant-bearing row to active.
UPDATE products p
   SET status = 'active'
  FROM _dup_pairs d
 WHERE p.id = d.keep_id
   AND p.status <> 'active';

-- Archive the empty duplicate so the storefront catalog query hides it.
UPDATE products p
   SET status = 'archived'
  FROM _dup_pairs d
 WHERE p.id = d.archive_id
   AND p.id <> d.keep_id
   AND p.status <> 'archived';

DROP TABLE _dup_pairs;

ANALYZE products;

COMMIT;
