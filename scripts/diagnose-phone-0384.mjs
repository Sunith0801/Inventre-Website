// Node version of diagnose-phone-0384.sql (psql isn't installed on this host).
// Run: node --env-file=.env scripts/diagnose-phone-0384.mjs
//   or: DATABASE_URL=... node scripts/diagnose-phone-0384.mjs
import postgres from "postgres";

const PHONE = "7981810384";
const LAST10 = PHONE;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = postgres(url, { max: 1 });

function print(rows) {
  if (!rows || rows.length === 0) {
    console.log("  (no rows)");
    return;
  }
  console.table(rows);
}

try {
  console.log("\n── 1. parents rows whose phone matches (last-10 normalised) ──");
  print(await sql`
    SELECT id, phone, name, email, customer_code, status, created_at,
           (SELECT count(*)::int FROM students s WHERE s.parent_id = p.id) AS student_count
      FROM parents p
     WHERE right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10) = ${LAST10}
     ORDER BY created_at
  `);

  console.log("\n── 2. Student 223 — registered parent ──");
  print(await sql`
    SELECT s.id AS student_id, s.name, s.enrollment_number, s.school_code, s.grade,
           s.parent_id, p.phone AS parent_phone, p.name AS parent_name, p.customer_code
      FROM students s
      LEFT JOIN parents p ON p.id = s.parent_id
     WHERE s.enrollment_number = '223'
        OR s.id IN (
            SELECT student_id FROM student_guardian_links
             WHERE right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = ${LAST10}
          )
  `);

  console.log("\n── 3. Guardian-link rows for those students ──");
  print(await sql`
    WITH target_students AS (
      SELECT s.id FROM students s
       WHERE s.enrollment_number = '223'
          OR s.id IN (
              SELECT student_id FROM student_guardian_links
               WHERE right(regexp_replace(coalesce(phone_no,''), '\D', '', 'g'), 10) = ${LAST10}
            )
    )
    SELECT gl.student_id, gl.row_idx, gl.guardian_name, gl.relation,
           gl.phone_no, gl.email, gl.guardian_erp_name
      FROM student_guardian_links gl
     WHERE gl.student_id IN (SELECT id FROM target_students)
     ORDER BY gl.student_id, gl.row_idx
  `);

  console.log("\n── 4. guardians (ERP master) still holding the old number ──");
  print(await sql`
    SELECT erp_name, guardian_name, mobile_number, alternate_number, email_address
      FROM guardians
     WHERE right(regexp_replace(coalesce(mobile_number,''),    '\D', '', 'g'), 10) = ${LAST10}
        OR right(regexp_replace(coalesce(alternate_number,''), '\D', '', 'g'), 10) = ${LAST10}
  `);

  console.log("\n── 5. Other students attached to parent rows from (1) ──");
  print(await sql`
    SELECT s.id, s.name, s.enrollment_number, s.school_code, s.grade, s.parent_id
      FROM students s
     WHERE s.parent_id IN (
             SELECT id FROM parents
              WHERE right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10) = ${LAST10}
           )
     ORDER BY s.parent_id, s.name
  `);

  console.log("\n── 6. Exact-match duplicate check (mirrors the API guard) ──");
  print(await sql`
    SELECT p.id, p.phone, p.created_at,
           EXISTS (SELECT 1 FROM students WHERE parent_id = p.id) AS has_student
      FROM parents p
     WHERE p.phone = ${PHONE}
  `);
} finally {
  await sql.end({ timeout: 2 });
}
