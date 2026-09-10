-- Track when we last asked CCAvenue's Status API about a still-pending
-- payment. The parent-side polling endpoint and the server-side reconciler
-- cron both update this column so neither hammers CCAvenue, and the
-- partial index makes the reconciler's "find me pending rows due for
-- another check" sweep cheap.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS last_status_poll_at timestamptz;

-- payments.payment_finalized is declared in db/schema.ts but no migration
-- ever added it — another column that reached the live databases through
-- `drizzle-kit push`. The partial index below reads it, so on an empty
-- database this migration aborted the chain. Added here, IF NOT EXISTS, with
-- the default schema.ts declares; on a live database this line does nothing.
-- (2026-09-10, same family as 0014_missing_pushed_tables.sql.)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_finalized boolean NOT NULL DEFAULT false;

-- Filtered to the only rows the sweeper looks at — keeps the index small
-- (most payments finalise in seconds, this set never grows large).
CREATE INDEX IF NOT EXISTS payments_pending_poll_idx
  ON payments (last_status_poll_at NULLS FIRST)
  WHERE status = 'pending' AND payment_finalized = false;
