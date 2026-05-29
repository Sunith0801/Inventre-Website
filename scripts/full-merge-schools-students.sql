-- ════════════════════════════════════════════════════════════════════
-- Full merge: drop erp_* tables, fold their data into schools/students,
-- rename erp_guardians → guardians, erp_grades → grades.
--
-- After this script:
--   - `schools` is the single source for school records (storefront +
--     admin). Extended with ERP-rich columns.
--   - `students` is the single source for student records. parent_id is
--     nullable so ERP-only students fit.
--   - `guardians`, `grades` are top-level entities.
--   - `school_coordinators`, `school_grade_mappings`,
--     `school_uniform_mappings`, `student_addresses`, `student_guardian_links`,
--     `student_siblings` are the new child tables (referencing schools.id
--     and students.id respectively).
--   - All `erp_*` tables are gone.
--
-- Existing FK references (productSchool, itemPrices, bundleConfigs,
-- discountRules, users, productAttributes → schools.id; orders, carts,
-- shipments → students.id; parents → students.parent_id) are UNTOUCHED
-- because we mutate the schools/students tables in place rather than
-- replacing them.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Extend `schools` with all erp_schools columns ────────────
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS school_code text,
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS school_logo_url text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS pincode text,
  ADD COLUMN IF NOT EXISTS uniform_details_checkbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS books_details_checkbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS erp_name text,
  ADD COLUMN IF NOT EXISTS erp_raw jsonb,
  ADD COLUMN IF NOT EXISTS erp_modified timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS schools_erp_name_idx ON schools(erp_name) WHERE erp_name IS NOT NULL;
CREATE INDEX        IF NOT EXISTS schools_school_code_idx ON schools(school_code);

-- ── 2. Copy ERP-rich fields onto matching `schools` rows ───────
UPDATE schools s
   SET school_code = es.school_code,
       branch_name = es.branch_name,
       website_url = es.website_url,
       school_logo_url = es.school_logo_url,
       street = es.street,
       country = es.country,
       pincode = es.pincode,
       uniform_details_checkbox = es.uniform_details_checkbox,
       books_details_checkbox = es.books_details_checkbox,
       erp_name = es.erp_name,
       erp_raw = es.raw,
       erp_modified = es.erp_modified,
       synced_at = es.synced_at,
       name = COALESCE(es.school_name, s.name)
  FROM erp_schools es
 WHERE s.id = es.storefront_school_id;

-- ── 3. New child tables for schools ────────────────────────────
CREATE TABLE IF NOT EXISTS school_coordinators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  row_idx int NOT NULL,
  poc_name text,
  email text,
  contact_number text,
  alternate_number text,
  role text,
  raw jsonb
);
CREATE INDEX IF NOT EXISTS school_coordinators_school_idx ON school_coordinators(school_id);

CREATE TABLE IF NOT EXISTS school_grade_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  row_idx int NOT NULL,
  grade text,
  school_given_grade_name text,
  sections text,
  raw jsonb
);
CREATE INDEX IF NOT EXISTS school_grade_mappings_school_idx ON school_grade_mappings(school_id);

CREATE TABLE IF NOT EXISTS school_uniform_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  row_idx int NOT NULL,
  grade text,
  organisation_given_grade text,
  sections text,
  organisation_given_section text,
  house_name text,
  raw jsonb
);
CREATE INDEX IF NOT EXISTS school_uniform_mappings_school_idx ON school_uniform_mappings(school_id);

-- ── 4. Migrate school child data ───────────────────────────────
INSERT INTO school_coordinators (school_id, row_idx, poc_name, email, contact_number, alternate_number, role, raw)
SELECT s.id, c.row_idx, c.poc_name, c.email, c.contact_number, c.alternate_number, c.role, c.raw
  FROM erp_school_coordinators c
  JOIN erp_schools es ON es.id = c.school_id
  JOIN schools s ON s.id = es.storefront_school_id;

INSERT INTO school_grade_mappings (school_id, row_idx, grade, school_given_grade_name, sections, raw)
SELECT s.id, g.row_idx, g.grade, g.school_given_grade_name, g.sections, g.raw
  FROM erp_school_grades g
  JOIN erp_schools es ON es.id = g.school_id
  JOIN schools s ON s.id = es.storefront_school_id;

INSERT INTO school_uniform_mappings (school_id, row_idx, grade, organisation_given_grade, sections, organisation_given_section, house_name, raw)
SELECT s.id, u.row_idx, u.grade, u.organisation_given_grade, u.sections, u.organisation_given_section, u.house_name, u.raw
  FROM erp_school_uniform_mappings u
  JOIN erp_schools es ON es.id = u.school_id
  JOIN schools s ON s.id = es.storefront_school_id;

-- ── 5. Drop erp_school_* child tables ──────────────────────────
DROP TABLE erp_school_coordinators;
DROP TABLE erp_school_grades;
DROP TABLE erp_school_uniform_mappings;

-- ── 6. Make students.parent_id nullable + extend ───────────────
ALTER TABLE students ALTER COLUMN parent_id DROP NOT NULL;
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_new_student boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS school_code text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS grade text,
  ADD COLUMN IF NOT EXISTS joining_date text,
  ADD COLUMN IF NOT EXISTS house_color text,
  ADD COLUMN IF NOT EXISTS medium text,
  ADD COLUMN IF NOT EXISTS curriculum text,
  ADD COLUMN IF NOT EXISTS shoe_size text,
  ADD COLUMN IF NOT EXISTS shirt_size text,
  ADD COLUMN IF NOT EXISTS trouser_size text,
  ADD COLUMN IF NOT EXISTS profile_picture_url text,
  ADD COLUMN IF NOT EXISTS student_email_id text,
  ADD COLUMN IF NOT EXISTS student_mobile_number text,
  ADD COLUMN IF NOT EXISTS date_of_birth text,
  ADD COLUMN IF NOT EXISTS blood_group text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS customer_link text,
  ADD COLUMN IF NOT EXISTS customer_group text,
  ADD COLUMN IF NOT EXISTS erp_name text,
  ADD COLUMN IF NOT EXISTS erp_raw jsonb,
  ADD COLUMN IF NOT EXISTS erp_modified timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS students_erp_name_idx ON students(erp_name) WHERE erp_name IS NOT NULL;
CREATE INDEX        IF NOT EXISTS students_school_code_idx ON students(school_code);
CREATE INDEX        IF NOT EXISTS students_first_name_idx ON students(first_name);
CREATE INDEX        IF NOT EXISTS students_grade_idx ON students(grade);

-- ── 7. Backfill existing students rows from erp_students ──────
-- For students whose erp_students.parent_id matches (the bridge),
-- copy all the rich fields onto the storefront row.
UPDATE students s
   SET enabled = es.enabled,
       is_new_student = es.is_new_student,
       is_verified = es.is_verified,
       school_code = es.school_code,
       first_name = es.first_name,
       middle_name = es.middle_name,
       last_name = es.last_name,
       grade = es.grade,
       joining_date = es.joining_date,
       house_color = es.house_color,
       medium = es.medium,
       curriculum = es.curriculum,
       shoe_size = es.shoe_size,
       shirt_size = es.shirt_size,
       trouser_size = es.trouser_size,
       profile_picture_url = es.profile_picture_url,
       student_email_id = es.student_email_id,
       student_mobile_number = es.student_mobile_number,
       date_of_birth = es.date_of_birth,
       blood_group = es.blood_group,
       gender = es.gender,
       nationality = es.nationality,
       customer_link = es.customer,
       customer_group = es.customer_group,
       erp_name = es.erp_name,
       erp_raw = es.raw,
       erp_modified = es.erp_modified,
       synced_at = es.synced_at,
       name = COALESCE(NULLIF(TRIM(CONCAT_WS(' ', es.first_name, es.middle_name, es.last_name)), ''), s.name)
  FROM erp_students es
 WHERE s.parent_id = es.parent_id
   AND es.parent_id IS NOT NULL;

-- ── 8. INSERT new students rows for erp_students that have no
--    corresponding storefront row (the bulk — 20K+ ERP students). ─
-- school_id resolved via schools.school_code matching erp_students.school_code.
-- parent_id stays NULL for these (no linked parent account).
INSERT INTO students (
  parent_id, school_id, name, class, section, enrollment_number, status,
  enabled, is_new_student, is_verified, school_code,
  first_name, middle_name, last_name, grade, joining_date,
  house_color, medium, curriculum, shoe_size, shirt_size, trouser_size,
  profile_picture_url, student_email_id, student_mobile_number,
  date_of_birth, blood_group, gender, nationality, customer_link,
  customer_group, erp_name, erp_raw, erp_modified, synced_at
)
SELECT
  es.parent_id,
  s.id,
  COALESCE(NULLIF(TRIM(CONCAT_WS(' ', es.first_name, es.middle_name, es.last_name)), ''), es.erp_name),
  es.grade,
  es.section,
  es.enrollment_number,
  CASE WHEN es.enabled THEN 'active'::account_status ELSE 'blocked'::account_status END,
  es.enabled, es.is_new_student, es.is_verified, es.school_code,
  es.first_name, es.middle_name, es.last_name, es.grade, es.joining_date,
  es.house_color, es.medium, es.curriculum, es.shoe_size, es.shirt_size, es.trouser_size,
  es.profile_picture_url, es.student_email_id, es.student_mobile_number,
  es.date_of_birth, es.blood_group, es.gender, es.nationality, es.customer,
  es.customer_group, es.erp_name, es.raw, es.erp_modified, es.synced_at
  FROM erp_students es
  JOIN schools s ON s.school_code = es.school_code
 WHERE NOT EXISTS (
   SELECT 1 FROM students stu
    WHERE stu.parent_id = es.parent_id AND es.parent_id IS NOT NULL
 );

-- ── 9. New child tables for students ───────────────────────────
CREATE TABLE IF NOT EXISTS student_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind text NOT NULL,
  row_idx int NOT NULL,
  address_type text,
  address_title text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  country text,
  pincode text,
  preferred boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  raw jsonb
);
CREATE INDEX IF NOT EXISTS student_addresses_student_idx ON student_addresses(student_id);

CREATE TABLE IF NOT EXISTS student_guardian_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  row_idx int NOT NULL,
  guardian_erp_name text,
  guardian_name text,
  relation text,
  email text,
  phone_no text,
  raw jsonb
);
CREATE INDEX IF NOT EXISTS student_guardian_links_student_idx ON student_guardian_links(student_id);
CREATE INDEX IF NOT EXISTS student_guardian_links_guardian_ref_idx ON student_guardian_links(guardian_erp_name);

CREATE TABLE IF NOT EXISTS student_siblings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  row_idx int NOT NULL,
  full_name text,
  gender text,
  grade text,
  section text,
  date_of_birth text,
  raw jsonb
);
CREATE INDEX IF NOT EXISTS student_siblings_student_idx ON student_siblings(student_id);

-- ── 10. Migrate student child data, mapping erp_students.id → students.id by erp_name ─
INSERT INTO student_addresses (student_id, kind, row_idx, address_type, address_title, address_line_1, address_line_2, city, state, country, pincode, preferred, disabled, raw)
SELECT stu.id, a.kind, a.row_idx, a.address_type, a.address_title, a.address_line_1, a.address_line_2, a.city, a.state, a.country, a.pincode, a.preferred, a.disabled, a.raw
  FROM erp_student_addresses a
  JOIN erp_students es ON es.id = a.student_id
  JOIN students stu ON stu.erp_name = es.erp_name;

INSERT INTO student_guardian_links (student_id, row_idx, guardian_erp_name, guardian_name, relation, email, phone_no, raw)
SELECT stu.id, gl.row_idx, gl.guardian_erp_name, gl.guardian_name, gl.relation, gl.email, gl.phone_no, gl.raw
  FROM erp_student_guardian_links gl
  JOIN erp_students es ON es.id = gl.student_id
  JOIN students stu ON stu.erp_name = es.erp_name;

INSERT INTO student_siblings (student_id, row_idx, full_name, gender, grade, section, date_of_birth, raw)
SELECT stu.id, sb.row_idx, sb.full_name, sb.gender, sb.grade, sb.section, sb.date_of_birth, sb.raw
  FROM erp_student_siblings sb
  JOIN erp_students es ON es.id = sb.student_id
  JOIN students stu ON stu.erp_name = es.erp_name;

-- ── 11. Drop the erp_student_* tables ───────────────────────────
DROP TABLE erp_student_addresses;
DROP TABLE erp_student_guardian_links;
DROP TABLE erp_student_siblings;

-- ── 12. Drop erp_students and erp_schools (top-level erp masters) ─
DROP TABLE erp_students;
DROP TABLE erp_schools;

-- ── 13. Rename erp_guardians → guardians, erp_grades → grades ───
ALTER TABLE erp_guardians RENAME TO guardians;
ALTER INDEX erp_guardians_erp_name_idx RENAME TO guardians_erp_name_idx;
ALTER INDEX erp_guardians_name_idx     RENAME TO guardians_name_idx;
ALTER INDEX erp_guardians_mobile_idx   RENAME TO guardians_mobile_idx;

ALTER TABLE erp_grades RENAME TO grades;
ALTER INDEX erp_grades_erp_name_idx RENAME TO grades_erp_name_idx;
ALTER INDEX erp_grades_status_idx   RENAME TO grades_status_idx;

COMMIT;

-- Sanity counts after merge:
SELECT 'schools'               AS table_name, COUNT(*)::text AS n FROM schools
UNION ALL SELECT 'students',                  COUNT(*)::text FROM students
UNION ALL SELECT 'guardians',                 COUNT(*)::text FROM guardians
UNION ALL SELECT 'grades',                    COUNT(*)::text FROM grades
UNION ALL SELECT 'school_coordinators',       COUNT(*)::text FROM school_coordinators
UNION ALL SELECT 'school_grade_mappings',     COUNT(*)::text FROM school_grade_mappings
UNION ALL SELECT 'school_uniform_mappings',   COUNT(*)::text FROM school_uniform_mappings
UNION ALL SELECT 'student_addresses',         COUNT(*)::text FROM student_addresses
UNION ALL SELECT 'student_guardian_links',    COUNT(*)::text FROM student_guardian_links
UNION ALL SELECT 'student_siblings',          COUNT(*)::text FROM student_siblings
ORDER BY 1;
