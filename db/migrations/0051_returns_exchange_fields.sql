-- 0051 — Exchange-flow fields on returns (2026-06-07)
--
-- Phase 1 of the customer-raised exchange flow (see
-- ~/.claude/plans/so-actually-customers-are-dapper-crayon.md). The
-- existing `returns` table already supports the refund path
-- (requested → approved → received → refunded). We layer the new
-- exchange flow on top of the same table by adding two columns and
-- one composite index:
--
--   • kind         — distinguishes 'refund' rows (the historical flow)
--                    from 'exchange' rows (the new flow). Defaults to
--                    'refund' so every existing row keeps its semantics
--                    untouched.
--   • pickup_date  — the Saturday on which the parent should visit
--                    school to collect the exchanged item. Computed at
--                    creation as the first Saturday at least 7 days
--                    after the request, in IST. Stored as a `date`
--                    (no tz) since we only care about the calendar day.
--   • (parent_id, status) — the storefront needs to look up "active
--                    exchange for this parent on this order" on every
--                    order-detail render. Without this index the lookup
--                    falls back to seq scan + parent_id filter.
--
-- The feature is gated to a single tester phone via the
-- EXCHANGE_TESTER_PHONES env var, so until rollout widens these new
-- columns will only be populated for one parent (7013232148). The
-- migration is still safe to land — existing rows backfill to
-- kind='refund', pickup_date stays NULL, and no admin code branches on
-- kind today.

BEGIN;

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'refund',
  ADD COLUMN IF NOT EXISTS pickup_date date;

-- Constrain `kind` to known values. Drop-then-add so re-running the
-- migration against a half-applied DB lands cleanly.
ALTER TABLE returns
  DROP CONSTRAINT IF EXISTS returns_kind_check;
ALTER TABLE returns
  ADD CONSTRAINT returns_kind_check CHECK (kind IN ('refund', 'exchange'));

CREATE INDEX IF NOT EXISTS returns_parent_status_idx
  ON returns (parent_id, status);

COMMIT;
