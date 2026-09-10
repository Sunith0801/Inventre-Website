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

--
-- GUARDED, 2026-09-10. This file is a data backfill, and it reads
-- student_guardian_links — a table that, until today, NO migration in this
-- directory created. It existed only because `drizzle-kit push` made it on
-- the live databases. On an empty database the chain therefore died right
-- here, at 0015 of 85, which is why the schema could not be rebuilt from
-- source and why CI had no build gate.
--
-- 0014_missing_pushed_tables.sql now creates that table (and ten others),
-- and sorts ahead of this file, so the backfill does find it. The guard
-- stays anyway: it costs nothing, and a data migration that assumes the
-- shape of a database it did not create is exactly the assumption that broke
-- here. When the table is absent the backfill is a no-op, which is correct on
-- its own terms — a database with no guardian links has no guardians to
-- resolve.
--
-- On every database where this migration has already run it is recorded in
-- __schema_migrations by FILENAME and never re-read, so this edit changes
-- nothing that has already happened.

DO $$
BEGIN
  IF to_regclass('public.student_guardian_links') IS NULL THEN
    RAISE NOTICE '[0015] student_guardian_links absent - nothing to backfill, skipping';
    RETURN;
  END IF;

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
END $$;
