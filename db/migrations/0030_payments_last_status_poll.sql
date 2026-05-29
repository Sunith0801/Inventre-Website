-- Track when we last asked CCAvenue's Status API about a still-pending
-- payment. The parent-side polling endpoint and the server-side reconciler
-- cron both update this column so neither hammers CCAvenue, and the
-- partial index makes the reconciler's "find me pending rows due for
-- another check" sweep cheap.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS last_status_poll_at timestamptz;

-- Filtered to the only rows the sweeper looks at — keeps the index small
-- (most payments finalise in seconds, this set never grows large).
CREATE INDEX IF NOT EXISTS payments_pending_poll_idx
  ON payments (last_status_poll_at NULLS FIRST)
  WHERE status = 'pending' AND payment_finalized = false;
