-- Diagnose the "new → old swap blocked / search shows old number" bug
-- for the parent whose old phone is 7981810384 (student 223 at St. Michaels).
--
-- Run:   psql "$DATABASE_URL" -f scripts/diagnose-phone-0384.sql
--
-- Set the number once here, then every query below uses it.
\set phone '''7981810384'''
\set last10 '''7981810384'''

\echo '── 1. Every parents row whose phone matches (any formatting) ──'
SELECT id,
       phone,
       name,
       email,
       customer_code,
       status,
       created_at,
       (SELECT count(*) FROM students s WHERE s.parent_id = p.id) AS student_count
  FROM parents p
 WHERE right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10) = :last10
 ORDER BY created_at;

\echo ''
\echo '── 2. Student 223 — who is the registered parent? ──'
SELECT s.id            AS student_id,
       s.name,
       s.enrollment_number,
       s.school_code,
       s.grade,
       s.parent_id,
       p.phone         AS parent_phone,
       p.name          AS parent_name,
       p.customer_code
  FROM students s
  LEFT JOIN parents p ON p.id = s.parent_id
 WHERE s.enrollment_number = '223'
    OR s.id::text IN (
        SELECT student_id::text FROM student_guardian_links
         WHERE right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = :last10
       );

\echo ''
\echo '── 3. All guardian-link rows for those students ──'
WITH target_students AS (
  SELECT s.id FROM students s
   WHERE s.enrollment_number = '223'
      OR s.id IN (
          SELECT student_id FROM student_guardian_links
           WHERE right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = :last10
        )
)
SELECT gl.student_id,
       gl.row_idx,
       gl.guardian_name,
       gl.relation,
       gl.phone_no,
       gl.email,
       gl.guardian_erp_name
  FROM student_guardian_links gl
 WHERE gl.student_id IN (SELECT id FROM target_students)
 ORDER BY gl.student_id, gl.row_idx;

\echo ''
\echo '── 4. Any guardians (ERP master) still holding the old number ──'
SELECT erp_name,
       guardian_name,
       mobile_number,
       alternate_number,
       email_address
  FROM guardians
 WHERE right(regexp_replace(coalesce(mobile_number,''),    '\D', '', 'g'), 10) = :last10
    OR right(regexp_replace(coalesce(alternate_number,''), '\D', '', 'g'), 10) = :last10;

\echo ''
\echo '── 5. Any other students attached to the parent rows from (1) ──'
SELECT s.id, s.name, s.enrollment_number, s.school_code, s.grade, s.parent_id
  FROM students s
 WHERE s.parent_id IN (
         SELECT id FROM parents
          WHERE right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10) = :last10
       )
 ORDER BY s.parent_id, s.name;

\echo ''
\echo '── 6. Exact-match parents query the duplicate check uses ──'
\echo '   (this is what blocks the swap: any row here with has_student=true → 409)'
SELECT p.id,
       p.phone,
       p.created_at,
       EXISTS (SELECT 1 FROM students WHERE parent_id = p.id) AS has_student
  FROM parents p
 WHERE p.phone = :phone;
