-- Unique index on (school_id, lower(grade)) for school_grade_mappings.
-- Backstops the new-school wizard's grade-mappings/bulk endpoint against
-- two parallel submissions racing on the read-then-insert path.
--
-- lower(grade) so re-entering "grade 1" after "Grade 1" collides instead of
-- silently creating a second row. The bulk endpoint dedups case-insensitively
-- already; this makes the DB the source of truth.
--
-- Existing duplicates (if any) must be removed before applying:
--   WITH dups AS (
--     SELECT id, row_number() OVER (
--       PARTITION BY school_id, lower(grade) ORDER BY row_idx
--     ) AS rn FROM school_grade_mappings WHERE grade IS NOT NULL
--   ) DELETE FROM school_grade_mappings WHERE id IN (SELECT id FROM dups WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS school_grade_mappings_school_grade_uq
  ON school_grade_mappings (school_id, lower(grade))
  WHERE grade IS NOT NULL;
