-- MyClassBoard (MCB) integration: student + fee-payment master data.
--
-- Pulled nightly by scripts/import-from-mcb.ts. Restricted via env allowlist
-- to St Andrews / St Michaels / Winmore. Kept independent from the existing
-- `students` table so a future ERPNext student sync can populate that one
-- without colliding with MCB enrolment numbers.
--
-- `website_access` is admin-controlled (manual toggle in /admin/mcb) and the
-- nightly upsert must NOT overwrite it.

CREATE TABLE IF NOT EXISTS mcb_students (
  enrolment_number     text PRIMARY KEY,
  student_name         text,
  school_name          text,
  grade                text,
  section              text,
  mobile_number        text,
  email                text,
  last_fee_paid_date   date,
  last_fee_paid_amount numeric(12, 2),
  website_access       boolean     NOT NULL DEFAULT false,
  website_access_at    timestamptz,
  website_access_by    text,
  raw                  jsonb,
  synced_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcb_students_school_idx
  ON mcb_students (school_name);
CREATE INDEX IF NOT EXISTS mcb_students_last_paid_date_idx
  ON mcb_students (last_fee_paid_date);

CREATE TABLE IF NOT EXISTS mcb_fee_payments (
  enrolment_number text NOT NULL,
  payment_date     date NOT NULL,
  receipt_no       text NOT NULL DEFAULT '',
  amount           numeric(12, 2),
  fee_head         text,
  raw              jsonb,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enrolment_number, payment_date, receipt_no)
);
CREATE INDEX IF NOT EXISTS mcb_fee_payments_date_idx
  ON mcb_fee_payments (payment_date);
