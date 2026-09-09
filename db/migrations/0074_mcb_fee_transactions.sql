-- Real MCB fee receipts.
--
-- `mcb_fee_payments` is the *receivables* feed and carries no receipt at
-- all: its `receipt_no` is MCB's internal FeeInstallmentStudentID (identical
-- on all 208k rows) and its `payment_date` is the VoucherDate — when the
-- receivable was raised, not when money arrived. Genuine receipts live only
-- behind GET_StudentFee_Transactions, which is keyed per student, so they
-- are imported nightly into this table to make them searchable and
-- exportable. One row per receipted fee LINE: a single receipt number
-- routinely settles several fee heads at once.
CREATE TABLE IF NOT EXISTS mcb_fee_transactions (
  -- Deterministic natural key built by the importer. MCB exposes no row id
  -- for a receipt line, and (receipt, fee type) is not unique on its own —
  -- fee account + occurrence separate "Tuition fee (July)" from
  -- "Tuition fee (August)" on the same receipt.
  txn_key          text PRIMARY KEY,
  enrolment_number text NOT NULL,
  receipt_no       text NOT NULL DEFAULT '',
  paid_date        date,
  amount           numeric(12,2) NOT NULL DEFAULT 0,
  fee_type         text,
  payment_mode     text,
  payment_mode_id  integer,
  transaction_id   text,
  is_online        boolean NOT NULL DEFAULT false,
  academic_year    text,
  branch_id        integer,
  student_id       integer,
  fee_account_id   integer,
  occurrence_id    integer,
  raw              jsonb,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcb_fee_txn_enrolment_idx
  ON mcb_fee_transactions (enrolment_number);
-- Ops paste a receipt number straight off a parent's screenshot.
CREATE INDEX IF NOT EXISTS mcb_fee_txn_receipt_idx
  ON mcb_fee_transactions (receipt_no);
CREATE INDEX IF NOT EXISTS mcb_fee_txn_paid_date_idx
  ON mcb_fee_transactions (paid_date);
CREATE INDEX IF NOT EXISTS mcb_fee_txn_ay_idx
  ON mcb_fee_transactions (academic_year);

-- Per-student fetch bookkeeping. The importer needs this to (a) resume a
-- 12k-student backfill after an interruption and (b) tell "never fetched"
-- apart from "fetched, genuinely has no receipts" — without it, every
-- student with no payments would be re-fetched on every run forever.
CREATE TABLE IF NOT EXISTS mcb_fee_txn_sync (
  enrolment_number text NOT NULL,
  academic_year_id integer NOT NULL,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  rows_seen        integer NOT NULL DEFAULT 0,
  ok               boolean NOT NULL DEFAULT true,
  error            text,
  PRIMARY KEY (enrolment_number, academic_year_id)
);

CREATE INDEX IF NOT EXISTS mcb_fee_txn_sync_fetched_idx
  ON mcb_fee_txn_sync (fetched_at);
