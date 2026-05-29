-- 0041 — Kit grade internal remap (2026-05-27)
--
-- Migration 0038 incorrectly kept the school-given grade encoded in the
-- product name (e.g. "Grade 12" in "SAS Suchitra Grade 12 MBPC") and
-- deleted every other grade tag. That broke catalog matching for
-- schools whose `student.grade` uses a different internal enumeration
-- (recorded in `school_grade_mappings.grade`), most notably:
--
--   SAS Suchitra:  Class 12  → student.grade = "Grade 15"
--   SMS:           Class 6   → student.grade = "Grade 9"
--   Kidlink:       Class 12  → student.grade = "Grade 15"
--
-- The storefront filter (lib/repos/products.ts:629 — `pg.grade = ${student.grade}`)
-- only sees the internal grade, so any product tagged solely with the
-- school-given label became invisible to students of the relevant
-- class.
--
-- Fix: for every kit + school link, translate the name-encoded
-- school-given grade into the internal grade via school_grade_mappings,
-- INSERT the internal grade into product_grades (idempotent), and
-- DELETE the name-encoded grade IF a translation exists and differs
-- from the internal one. Schools with no mapping for the grade keep
-- the original tag untouched.
--
-- Idempotent.

BEGIN;

-- 1. Resolve every (kit, school) pair to its internal grade.
WITH kit_school AS (
  SELECT
    p.id   AS product_id,
    ps.school_id,
    p.name AS product_name,
    CASE
      WHEN p.name ~* '\mGrade[ \-_]?(\d{1,2})\M' THEN
        'Grade ' || (regexp_match(p.name, 'Grade[ \-_]?(\d{1,2})', 'i'))[1]
      WHEN p.name ~* '\mNursery\M' THEN 'Nursery'
      WHEN p.name ~* '\mLKG\M'     THEN 'LKG'
      WHEN p.name ~* '\mUKG\M'     THEN 'UKG'
      ELSE NULL
    END AS school_given_grade
  FROM products p
  JOIN product_school ps ON ps.product_id = p.id
  WHERE p.kind = 'kit'
),
resolved AS (
  SELECT
    ks.product_id,
    ks.school_given_grade,
    sgm.grade AS internal_grade
  FROM kit_school ks
  -- Lower-case match on the school-given label (some schools store
  -- "GRADE 9" while ours canonicalises to "Grade 9").
  JOIN school_grade_mappings sgm
    ON sgm.school_id = ks.school_id
   AND lower(sgm.school_given_grade_name) = lower(ks.school_given_grade)
  WHERE ks.school_given_grade IS NOT NULL
)
-- 2a. Insert the internal grade tag onto every affected kit.
INSERT INTO product_grades (product_id, grade)
SELECT DISTINCT r.product_id, r.internal_grade
  FROM resolved r
 WHERE r.internal_grade IS NOT NULL
ON CONFLICT (product_id, grade) DO NOTHING;

-- 2b. Remove the school-given grade tag when it differs from the
--     internal one — otherwise students in lower classes who happen
--     to have student.grade equal to the name-encoded label would
--     wrongly match the kit.
WITH kit_school AS (
  SELECT
    p.id   AS product_id,
    ps.school_id,
    CASE
      WHEN p.name ~* '\mGrade[ \-_]?(\d{1,2})\M' THEN
        'Grade ' || (regexp_match(p.name, 'Grade[ \-_]?(\d{1,2})', 'i'))[1]
      WHEN p.name ~* '\mNursery\M' THEN 'Nursery'
      WHEN p.name ~* '\mLKG\M'     THEN 'LKG'
      WHEN p.name ~* '\mUKG\M'     THEN 'UKG'
      ELSE NULL
    END AS school_given_grade
  FROM products p
  JOIN product_school ps ON ps.product_id = p.id
  WHERE p.kind = 'kit'
),
to_drop AS (
  SELECT DISTINCT ks.product_id, ks.school_given_grade
  FROM kit_school ks
  JOIN school_grade_mappings sgm
    ON sgm.school_id = ks.school_id
   AND lower(sgm.school_given_grade_name) = lower(ks.school_given_grade)
   AND lower(sgm.grade) <> lower(ks.school_given_grade)
)
DELETE FROM product_grades pg
USING to_drop d
WHERE pg.product_id = d.product_id
  AND lower(pg.grade) = lower(d.school_given_grade);

ANALYZE product_grades;

COMMIT;
