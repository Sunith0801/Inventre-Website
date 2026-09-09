-- 2026-07-08 one-time heal: backfill returns.duplicate_of for the pre-existing
-- rejected-as-duplicate exchanges whose duplicated request IS mirrored in
-- inventre (a sibling return on the same order). Only 5 of the 18 old rejected
-- exchanges qualify; the other 13 duplicate an audit-only request and need the
-- audit-side RTN mapping (not derivable here) — left untouched.
--
-- The sibling in all 5 cases is an approved RTN-M-* code, which is audit-minted
-- / care-team-raised (see memory: exchange-missing-numbering-single-source), so
-- raised_by = "team".
--
-- Idempotent: only fills rows still NULL. Re-runnable.

UPDATE returns r
SET duplicate_of = sub.dups
FROM (
  SELECT rej.id AS rej_id,
         jsonb_agg(
           jsonb_build_object(
             'return_number', sib.return_number,
             'status',        sib.status,
             'raised_by',     'team'
           )
           ORDER BY sib.created_at
         ) AS dups
  FROM returns rej
  JOIN returns sib
    ON sib.order_id = rej.order_id
   AND sib.id <> rej.id
   AND sib.status <> 'rejected'
  WHERE rej.kind = 'exchange'
    AND rej.status = 'rejected'
    AND rej.duplicate_of IS NULL
    AND rej.rejection_reason !~ 'RTN-(M-[0-9]+|[0-9]{4}-[0-9]+)'
  GROUP BY rej.id
) sub
WHERE r.id = sub.rej_id
  AND r.duplicate_of IS NULL;
