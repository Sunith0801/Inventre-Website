-- 0066: Search-first Parent Support Portal — richer concern model.
--
-- Adds the fields the dynamic per-category forms need (student link, sub-type,
-- free-form per-category answers as jsonb, routing team) and moves the default
-- status to the new vocabulary. Idempotent.

ALTER TABLE concerns ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES students(id);
ALTER TABLE concerns ADD COLUMN IF NOT EXISTS sub_type   text;            -- e.g. order_delivery: 'not_delivered' | 'partial' | 'wrong_item' | 'where'
ALTER TABLE concerns ADD COLUMN IF NOT EXISTS details    jsonb;           -- per-category captured fields (old/new mobile, grades, amounts, etc.)
ALTER TABLE concerns ADD COLUMN IF NOT EXISTS team       text;            -- routing: 'customer_care' | 'sales' | 'customer_care,sales'

-- New status vocabulary: submitted | in_progress | waiting_customer | waiting_school | resolved.
-- (No CHECK constraint — status is plain text, validated in the app.)
ALTER TABLE concerns ALTER COLUMN status SET DEFAULT 'submitted';

CREATE INDEX IF NOT EXISTS concerns_student_idx ON concerns (student_id);
