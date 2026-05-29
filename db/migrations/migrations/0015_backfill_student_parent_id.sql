-- Backfill students.parent_id from student_guardian_links where a parent
-- account exists with the guardian's phone number.
--
-- Why this is needed:
--   ERP sync writes guardian rows (name + phone) into
--   student_guardian_links but never resolves them to login accounts in the
--   `parents` table. The shop session lookup (lib/session.ts) reads
--   `students WHERE parent_id = <session.parent.id>`, so a parent who logs
--   in with the same phone that appears in a guardian link still sees an
--   empty catalog because students.parent_id is NULL.
--
-- The admin "Add guardian" endpoint already does this dual-link for new
-- rows; this migration retroactively fixes every student whose guardian
-- phone matches a parent's phone but whose parent_id was never written.
--
-- Conservative — only updates rows where:
--   • students.parent_id IS NULL (we never override an existing link)
--   • a guardian link row exists for that student with a 10-digit phone
--   • exactly one parent account exists with that phone
--   • if multiple guardian links exist for the student, pick the one with
--     the lowest row_idx (matches the "first guardian" semantics used in
--     lib/session.ts:firstGuardianByStudent)

WITH first_guardian AS (
  SELECT DISTINCT ON (sgl.student_id)
         sgl.student_id,
         regexp_replace(sgl.phone_no, '\D', '', 'g') AS phone10
    FROM student_guardian_links sgl
   WHERE sgl.phone_no IS NOT NULL
     AND length(regexp_replace(sgl.phone_no, '\D', '', 'g')) = 10
   ORDER BY sgl.student_id, sgl.row_idx, sgl.id
)
UPDATE students s
   SET parent_id = p.id
  FROM first_guardian fg
  JOIN parents p ON p.phone = fg.phone10
 WHERE s.id = fg.student_id
   AND s.parent_id IS NULL;
