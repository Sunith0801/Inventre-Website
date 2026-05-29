-- 0022_bulk_create_parents.sql
--
-- One-shot backfill: create a `parents` row for every distinct 10-digit
-- guardian phone that has at least one student_guardian_links entry
-- but no matching parents row yet. Then re-parent every student whose
-- primary (lowest-row_idx) guardian-link phone now resolves to a
-- freshly-created parent.
--
-- Why: 5,852 students currently have a 10-digit guardian phone but
-- `parent_id = NULL` because the parent has never logged in. Without a
-- parents row, recomputeStudentParent has nothing to attach to. After
-- this backfill, those students appear on the parent's storefront
-- picker the moment the parent OTPs in (first_time_login=true ensures
-- they go through the OTP + set-password flow before any cart action).
--
-- Atomic + idempotent: re-running is safe — the parents INSERT uses
-- ON CONFLICT on the unique phone index, and the UPDATE only fires
-- where parent_id is actually changing.

BEGIN;

-- (A) Insert parents for every distinct 10-digit guardian phone that
--     isn't already in parents. Name = the most-common guardian_name
--     across links with that phone (pick the longest non-empty as a
--     tiebreaker — proper capitalisation usually has more characters
--     than "—" or initial-only versions). Defaults handle the rest:
--     status=active, first_time_login=true, customer_group=student.
WITH guardian_phones AS (
  SELECT right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10) AS n10,
         -- Pick a sensible display name for the auto-created parent.
         (array_agg(gl.guardian_name ORDER BY length(coalesce(gl.guardian_name, '')) DESC, gl.row_idx))[1] AS guardian_name
    FROM student_guardian_links gl
   WHERE length(right(regexp_replace(coalesce(gl.phone_no, ''), '\D', '', 'g'), 10)) = 10
   GROUP BY 1
)
INSERT INTO parents (phone, name, status, first_time_login)
SELECT gp.n10, gp.guardian_name, 'active', true
  FROM guardian_phones gp
 WHERE NOT EXISTS (SELECT 1 FROM parents p WHERE p.phone = gp.n10)
    ON CONFLICT (phone) DO NOTHING;

-- (B) Re-parent every student whose primary guardian-link phone now
--     resolves to a parents row. Same rule as the recomputeStudentParent
--     helper in lib/repos/guardians.ts (lowest row_idx, then earliest
--     link id).
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
   AND s.parent_id IS DISTINCT FROM r.target_parent_id
   AND r.target_parent_id IS NOT NULL;

COMMIT;
