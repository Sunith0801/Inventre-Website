-- Phase 3 students mirror — shadow table for ERP student records.
--
-- Stores the full ERP student payload so the storefront can serve
-- student profiles without hitting ERP on every request. The
-- delta-poll advances the watermark in erp.sync_state('students').
--
-- public.students rows that already carry an erp_name are also
-- updated in-place by upsertStudentMirror (safe fields only — auth
-- columns like status/enabled are never touched).

CREATE TABLE IF NOT EXISTS erp.students (
  erp_name              TEXT        PRIMARY KEY,
  first_name            TEXT,
  enrollment_number     TEXT,
  school_code           TEXT,
  grade                 TEXT,
  section               TEXT,
  student_mobile_number TEXT,
  student_email_id      TEXT,
  gender                TEXT,
  date_of_birth         TEXT,
  customer              TEXT,
  customer_group        TEXT,
  house_color           TEXT,
  medium                TEXT,
  curriculum            TEXT,
  mobile_effective      TEXT,
  mobile_source         TEXT,
  primary_guardian_name TEXT,
  erp_modified          TIMESTAMPTZ,
  raw                   JSONB,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS erp_students_school_code_idx  ON erp.students (school_code);
CREATE INDEX IF NOT EXISTS erp_students_customer_idx     ON erp.students (customer);
CREATE INDEX IF NOT EXISTS erp_students_erp_modified_idx ON erp.students (erp_modified);
