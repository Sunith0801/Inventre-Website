-- 0020_guardian_link_phone_dedup.sql
--
-- Phone-as-canonical-guardian-identifier migration.
--
-- 1. Adds `known_erp_names text[]` to student_guardian_links so we can
--    fold duplicate ERPNext Guardian DocType IDs (e.g. `79927-N VIKRANTH`
--    + `79928-NEERADI VIKRANTH`) into a single row while retaining the
--    trace of which ERP names landed here.
-- 2. Dedupes existing rows by (student_id, last10(phone_no)). The
--    canonical row is the one with the lowest row_idx, then the earliest
--    id. Absorbed erp_names + the canonical's existing erp_name are
--    union-merged into the canonical's known_erp_names array.
-- 3. Creates a UNIQUE index on (student_id, last10(phone_no)) so future
--    inserts can't reintroduce duplicates even if a code path forgets
--    the upsertGuardianLink helper.
--
-- Idempotent: column add uses IF NOT EXISTS, dedup is a no-op when
-- already done (the unique index would block re-runs anyway, but the
-- script tolerates that by guarding the dedup CTE on the existence of
-- duplicates).

BEGIN;

ALTER TABLE student_guardian_links
  ADD COLUMN IF NOT EXISTS known_erp_names text[] NOT NULL DEFAULT '{}';

-- Pick the canonical row per (student_id, last10(phone)) — lowest
-- row_idx, then earliest id. Skip groups that have NULL / non-10-digit
-- phones; those don't collide with anything and can't be deduped.
WITH norm AS (
  SELECT id, student_id, row_idx, guardian_erp_name,
         right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10) AS n10
    FROM student_guardian_links
),
groups AS (
  SELECT student_id, n10,
         (array_agg(id ORDER BY row_idx, id))[1] AS canonical_id,
         array_agg(id ORDER BY row_idx, id)      AS all_ids,
         array_remove(array_agg(DISTINCT guardian_erp_name), NULL) AS erp_names
    FROM norm
   WHERE length(n10) = 10
   GROUP BY student_id, n10
  HAVING count(*) > 1
)
UPDATE student_guardian_links AS c
   SET known_erp_names = (
     SELECT array_agg(DISTINCT v)
       FROM unnest(c.known_erp_names || g.erp_names) AS v
      WHERE v IS NOT NULL
   )
  FROM groups g
 WHERE c.id = g.canonical_id;

-- Delete the absorbed rows (everything in the group except the canonical).
WITH norm AS (
  SELECT id, student_id, row_idx,
         right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10) AS n10
    FROM student_guardian_links
),
groups AS (
  SELECT student_id, n10,
         (array_agg(id ORDER BY row_idx, id))[1] AS canonical_id,
         array_agg(id ORDER BY row_idx, id)      AS all_ids
    FROM norm
   WHERE length(n10) = 10
   GROUP BY student_id, n10
  HAVING count(*) > 1
)
DELETE FROM student_guardian_links sgl
 USING groups g
 WHERE sgl.id = ANY(g.all_ids)
   AND sgl.id <> g.canonical_id;

-- Structural guarantee. Partial index excludes rows whose normalised
-- phone isn't 10 digits, so half-formed records (NULL phone, short
-- entries) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS student_guardian_links_unique_phone
  ON student_guardian_links
     (student_id, (right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10)))
   WHERE length(right(regexp_replace(coalesce(phone_no, ''), '\D', '', 'g'), 10)) = 10;

COMMIT;
