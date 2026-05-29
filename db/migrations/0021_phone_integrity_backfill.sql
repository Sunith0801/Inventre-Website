-- 0021_phone_integrity_backfill.sql
--
-- Phone-canonical integrity backfill, follow-on to 0020.
--
-- (A) Add `guardians.known_erp_names text[]` so we can dedupe the
--     guardians master table the same way we deduped
--     student_guardian_links in 0020.
--
-- (B) Re-parent every student. Rule: pick the lowest-row_idx
--     student_guardian_links row with a 10-digit phone, look up the
--     parents row matching that phone, set students.parent_id to it.
--     If no link has a 10-digit phone, set parent_id = NULL.
--     This fixes ~95 students that today have parent_id pointing at a
--     family their current guardian-links no longer match (e.g.
--     MAJJI BENPREETH attached to DONTULA's parent because of a since-
--     deleted link).
--
-- (C) Dedupe `guardians` master rows by last10(mobile_number). Pick
--     the canonical row (most-populated: non-null email_address >
--     non-null email > earliest erp_name > earliest id). Rewrite every
--     student_guardian_links.guardian_erp_name that referenced an
--     absorbed row to point at the canonical. Append the absorbed
--     rows' erp_names into the canonical's known_erp_names. Delete
--     the absorbed rows. ~108 groups today.
--
-- (D) Create a partial UNIQUE index `guardians_unique_phone` on
--     last10(mobile_number) so future inserts can't reintroduce
--     duplicates even if a code path forgets ensureGuardianMaster's
--     ON CONFLICT.
--
-- Idempotent: column adds use IF NOT EXISTS; the dedupe is a no-op
-- when no duplicates exist; the unique index uses IF NOT EXISTS.

BEGIN;

-- (A) Column add ----------------------------------------------------
ALTER TABLE guardians
  ADD COLUMN IF NOT EXISTS known_erp_names text[] NOT NULL DEFAULT '{}';

-- (B) Re-parent backfill --------------------------------------------
-- One UPDATE keyed off a CTE that resolves each student's "primary"
-- phone link → matching parent. NULL when no link has a 10-digit phone
-- (which detaches the student from whatever stale family it was on).
WITH primary_link AS (
  SELECT DISTINCT ON (gl.student_id)
         gl.student_id,
         right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10) AS n10
    FROM student_guardian_links gl
   WHERE length(right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10)) = 10
   ORDER BY gl.student_id, gl.row_idx ASC, gl.id ASC
),
resolved AS (
  SELECT s.id            AS student_id,
         s.parent_id     AS current_parent_id,
         p.id            AS target_parent_id
    FROM students s
    LEFT JOIN primary_link pl ON pl.student_id = s.id
    LEFT JOIN parents      p  ON p.phone        = pl.n10
)
UPDATE students s
   SET parent_id = r.target_parent_id
  FROM resolved r
 WHERE s.id = r.student_id
   AND s.parent_id IS DISTINCT FROM r.target_parent_id;

-- (C) Dedupe guardians master ---------------------------------------
-- Step 1: pick the canonical row per last10(mobile_number).
CREATE TEMP TABLE dedup_canonical ON COMMIT DROP AS
WITH ranked AS (
  SELECT id, erp_name, guardian_name, mobile_number, email, email_address, known_erp_names,
         right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10) AS n10,
         -- "Most populated" ranking: prefer rows with real ERP IDs over
         -- LOCAL- mints, then by completeness, then by oldest id.
         (CASE WHEN erp_name LIKE 'LOCAL-%' THEN 1 ELSE 0 END) AS local_rank,
         (CASE WHEN email_address IS NOT NULL AND email_address <> '' THEN 0 ELSE 1 END) AS email_rank,
         (CASE WHEN email         IS NOT NULL AND email         <> '' THEN 0 ELSE 1 END) AS email2_rank
    FROM guardians
   WHERE length(right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10)) = 10
),
canonical_id AS (
  SELECT n10,
         (array_agg(id ORDER BY local_rank, email_rank, email2_rank, erp_name, id))[1] AS id
    FROM ranked
   GROUP BY n10
)
SELECT c.id AS canonical_id, c.n10
  FROM canonical_id c;

-- Step 2: for each duplicate group, append absorbed rows' erp_names
-- (and their already-absorbed known_erp_names) into the canonical's
-- known_erp_names array.
WITH absorbed AS (
  SELECT g.id AS absorbed_id,
         g.erp_name AS absorbed_erp,
         g.known_erp_names AS absorbed_known,
         dc.canonical_id
    FROM guardians g
    JOIN dedup_canonical dc
      ON right(regexp_replace(coalesce(g.mobile_number, ''), '\D', '', 'g'), 10) = dc.n10
   WHERE g.id <> dc.canonical_id
),
merged AS (
  SELECT a.canonical_id,
         array_agg(DISTINCT v) FILTER (WHERE v IS NOT NULL) AS extras
    FROM absorbed a, LATERAL unnest(
           array_remove(array_cat(a.absorbed_known, ARRAY[a.absorbed_erp]), NULL)
         ) AS v
   GROUP BY a.canonical_id
)
UPDATE guardians g
   SET known_erp_names = (
     SELECT array_agg(DISTINCT v)
       FROM unnest(g.known_erp_names || m.extras) AS v
      WHERE v IS NOT NULL
   )
  FROM merged m
 WHERE g.id = m.canonical_id;

-- Step 3: rewrite student_guardian_links.guardian_erp_name references
-- that point at an absorbed row → repoint at the canonical's erp_name.
WITH rewrite AS (
  SELECT g.erp_name AS absorbed_erp,
         can.erp_name AS canonical_erp
    FROM guardians g
    JOIN dedup_canonical dc
      ON right(regexp_replace(coalesce(g.mobile_number, ''), '\D', '', 'g'), 10) = dc.n10
    JOIN guardians can ON can.id = dc.canonical_id
   WHERE g.id <> dc.canonical_id
     AND g.erp_name IS NOT NULL
     AND can.erp_name IS NOT NULL
)
UPDATE student_guardian_links sgl
   SET guardian_erp_name = r.canonical_erp
  FROM rewrite r
 WHERE sgl.guardian_erp_name = r.absorbed_erp;

-- Step 4: delete the absorbed master rows.
DELETE FROM guardians g
 USING dedup_canonical dc
 WHERE right(regexp_replace(coalesce(g.mobile_number, ''), '\D', '', 'g'), 10) = dc.n10
   AND g.id <> dc.canonical_id;

-- (D) Structural guarantee against future duplicates ----------------
CREATE UNIQUE INDEX IF NOT EXISTS guardians_unique_phone
  ON guardians
     ((right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10)))
   WHERE length(right(regexp_replace(coalesce(mobile_number, ''), '\D', '', 'g'), 10)) = 10;

COMMIT;
