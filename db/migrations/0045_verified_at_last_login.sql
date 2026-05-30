-- Add verified_at to students and last_login_at to parents.
-- Backfill verified_at from earliest 'verified' otp_logs entry for the
-- student's parent phone, falling back to students.created_at.
-- Backfill last_login_at from latest 'login' + 'verified' otp_logs entry
-- per parent phone.

ALTER TABLE students   ADD COLUMN IF NOT EXISTS verified_at   timestamptz;
ALTER TABLE parents    ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Backfill students.verified_at
WITH parent_first_verified AS (
  SELECT p.id AS parent_id,
         MIN(o.created_at) AS first_verified_at
    FROM parents p
    JOIN otp_logs o ON o.phone = p.phone
   WHERE o.event = 'verified'
   GROUP BY p.id
)
UPDATE students s
   SET verified_at = COALESCE(pfv.first_verified_at, s.created_at)
  FROM parent_first_verified pfv
 WHERE s.parent_id = pfv.parent_id
   AND s.is_verified = true
   AND s.verified_at IS NULL;

UPDATE students
   SET verified_at = created_at
 WHERE is_verified = true AND verified_at IS NULL;

-- Backfill parents.last_login_at
WITH last_login AS (
  SELECT phone, MAX(created_at) AS last_at
    FROM otp_logs
   WHERE purpose = 'login' AND event = 'verified'
   GROUP BY phone
)
UPDATE parents p
   SET last_login_at = ll.last_at
  FROM last_login ll
 WHERE p.phone = ll.phone
   AND p.last_login_at IS NULL;
