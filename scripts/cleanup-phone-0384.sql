-- One-off cleanup for the Sunith Kumar / 7981810384 swap-back bug.
-- Run via:
--   docker cp scripts/cleanup-phone-0384.sql inventre-deploy-postgres:/tmp/cleanup.sql \
--     && docker exec inventre-deploy-postgres psql -U inventre -d inventre -f /tmp/cleanup.sql
--
-- Wrapped in a single transaction. Verifies state both before and after so
-- you can eyeball the diff. The two mutations:
--   1. delete the empty zombie parent row holding 7981810384
--   2. heal the guardians ERP master so mobile_number matches the current
--      parent phone (9494980384) instead of the stale 7981810384

BEGIN;

\echo '── BEFORE ──'
SELECT 'parent row(s) holding 7981810384' AS label;
SELECT id, phone, name, status,
       (SELECT count(*)::int FROM students WHERE parent_id = p.id) AS student_count
  FROM parents p WHERE phone = '7981810384';

SELECT 'guardians ERP master 38758-Sunith Kumar' AS label;
SELECT erp_name, mobile_number, alternate_number
  FROM guardians WHERE erp_name = '38758-Sunith Kumar';

-- 1. Delete only if it's still empty. Guards against the row having
--    silently acquired a student between diagnose and cleanup.
DELETE FROM parents
 WHERE id = 'a507be0d-0b12-4b89-9394-66641395daa8'
   AND phone = '7981810384'
   AND NOT EXISTS (SELECT 1 FROM students WHERE parent_id = parents.id);

-- 2. Heal the guardian master. Scoped narrowly to the known ERP record so
--    we can't accidentally rewrite an unrelated guardian.
UPDATE guardians
   SET mobile_number = '9494980384'
 WHERE erp_name = '38758-Sunith Kumar'
   AND mobile_number = '7981810384';

\echo '── AFTER ──'
SELECT 'parent row(s) holding 7981810384' AS label;
SELECT id, phone, name, status,
       (SELECT count(*)::int FROM students WHERE parent_id = p.id) AS student_count
  FROM parents p WHERE phone = '7981810384';

SELECT 'guardians ERP master 38758-Sunith Kumar' AS label;
SELECT erp_name, mobile_number, alternate_number
  FROM guardians WHERE erp_name = '38758-Sunith Kumar';

COMMIT;
