-- 0038 — Kit grade cleanup (2026-05-27)
--
-- The ERPNext item feed ships `custom_grade` as a comma-separated list,
-- and for many "<School> Grade N Bookkit" rows that list contains
-- spurious extra grades (e.g. "Grade 3, Grade 6"). The ERP item
-- importer copies these verbatim into `product_grades`, so on the
-- storefront a Grade 6 student was seeing "SMS Grade 3 Bookkit" cards.
--
-- This migration is a one-shot data fix for kits only:
--   1. For every `products` row where `kind='kit'` and the name encodes
--      a canonical grade ("Grade N", "LKG", "UKG", "Nursery"), keep the
--      single name-encoded grade and delete every other `product_grades`
--      row for that product.
--   2. Insert the canonical grade row if it is missing.
--
-- Leaves non-kit products (books, sub_bundles, uniforms) untouched —
-- those legitimately span multiple grades.

BEGIN;

WITH kit_name_grade AS (
  SELECT
    p.id,
    CASE
      WHEN p.name ~* '\mGrade[ \-_]?(\d{1,2})\M' THEN
        'Grade ' || (regexp_match(p.name, 'Grade[ \-_]?(\d{1,2})', 'i'))[1]
      WHEN p.name ~* '\mNursery\M' THEN 'Nursery'
      WHEN p.name ~* '\mLKG\M' THEN 'LKG'
      WHEN p.name ~* '\mUKG\M' THEN 'UKG'
      ELSE NULL
    END AS canonical_grade
  FROM products p
  WHERE p.kind = 'kit'
)
-- 1. Delete grade rows that disagree with the canonical name-encoded grade.
DELETE FROM product_grades pg
USING kit_name_grade k
WHERE pg.product_id = k.id
  AND k.canonical_grade IS NOT NULL
  AND pg.grade <> k.canonical_grade;

-- 2. Ensure the canonical grade row exists for every kit that encodes one.
INSERT INTO product_grades (product_id, grade)
SELECT k.id, k.canonical_grade
  FROM (
    SELECT
      p.id,
      CASE
        WHEN p.name ~* '\mGrade[ \-_]?(\d{1,2})\M' THEN
          'Grade ' || (regexp_match(p.name, 'Grade[ \-_]?(\d{1,2})', 'i'))[1]
        WHEN p.name ~* '\mNursery\M' THEN 'Nursery'
        WHEN p.name ~* '\mLKG\M' THEN 'LKG'
        WHEN p.name ~* '\mUKG\M' THEN 'UKG'
        ELSE NULL
      END AS canonical_grade
    FROM products p
    WHERE p.kind = 'kit'
  ) k
 WHERE k.canonical_grade IS NOT NULL
ON CONFLICT (product_id, grade) DO NOTHING;

COMMIT;
