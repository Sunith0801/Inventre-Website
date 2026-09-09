-- 2026-07-08 one-time heal (round 2): backfill returns.duplicate_of for the 13
-- rejected-as-duplicate exchanges whose duplicated request lives ONLY on the
-- audit box (not mirrored in inventre). Mapping recovered from audit prod
-- (erp-new-with-api-db-1, crimpson_erp, exchange_requests) by matching each
-- rejected request's Sales Order (so_erp_name) to the active exchange on the
-- same SO. All 13 originals were created by staff (raw->>'created_by' =
-- "Call Centre"/"Manju"/"amrit") → raised_by = "team" (customer/web requests
-- have created_by = NULL, confirming the distinction).
--
-- Idempotent: only fills rows still NULL. Re-runnable.

UPDATE returns r
SET duplicate_of = m.dup::jsonb
FROM (VALUES
  ('RTN-2026-00235', '[{"return_number":"RTN-M-00953","status":"approved","raised_by":"team"}]'),
  ('RTN-2026-00240', '[{"return_number":"RTN-M-00939","status":"approved","raised_by":"team"}]'),
  ('RTN-2026-00256', '[{"return_number":"RTN-M-01082","status":"dispatched_to_school","raised_by":"team"}]'),
  ('RTN-2026-00280', '[{"return_number":"RTN-2026-01234","status":"dispatched_to_school","raised_by":"team"}]'),
  ('RTN-2026-00283', '[{"return_number":"RTN-2026-01303","status":"approved","raised_by":"team"}]'),
  ('RTN-2026-00300', '[{"return_number":"RTN-2026-01337","status":"approved","raised_by":"team"}]'),
  ('RTN-2026-00361', '[{"return_number":"RTN-2026-01241","status":"dispatched_to_school","raised_by":"team"}]'),
  ('RTN-2026-00367', '[{"return_number":"RTN-2026-01422","status":"approved","raised_by":"team"}]'),
  ('RTN-2026-00381', '[{"return_number":"RTN-M-00706","status":"dispatched_to_school","raised_by":"team"}]'),
  ('RTN-2026-00383', '[{"return_number":"RTN-M-01124","status":"dispatched_to_school","raised_by":"team"}]'),
  ('RTN-2026-00415', '[{"return_number":"RTN-2026-01417","status":"dispatched_to_school","raised_by":"team"}]'),
  ('RTN-2026-00474', '[{"return_number":"RTN-2026-01346","status":"approved","raised_by":"team"}]'),
  ('RTN-2026-00475', '[{"return_number":"RTN-M-00733","status":"approved","raised_by":"team"}]')
) AS m(rtn, dup)
WHERE r.return_number = m.rtn
  AND r.kind = 'exchange'
  AND r.status = 'rejected'
  AND r.duplicate_of IS NULL;
