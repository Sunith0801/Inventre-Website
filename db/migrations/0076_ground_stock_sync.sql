-- Ground Stock bridge: the audit ERP's Ground Stock page becomes the source
-- of truth for storefront availability.
--
-- Every 5 minutes the bridge (server/ground-stock-sync.ts) pulls the audit's
-- /api/ground-stock/dashboard, maps each ERP item code onto a storefront
-- variant, and writes the available quantity into the admin Stock module
-- (`bins`, one adjustment ledger row per change). The two tables here are
-- the bridge's own bookkeeping, not the stock figure itself:
--
--   ground_stock_sync       one row per variant the audit currently reports,
--                           with the raw audit figures behind the bin so an
--                           admin can see why a size reads "sold out".
--   ground_stock_sync_runs  one row per tick — what was fetched, matched,
--                           unmatched and changed, or the error that stopped it.
--
-- IF NOT EXISTS throughout: prod carries objects drizzle-kit pushed under
-- names a migration never wrote down (see 0014), so a bare CREATE can fail
-- on a table that is already there.

CREATE TABLE IF NOT EXISTS ground_stock_sync (
  variant_id   uuid PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
  item_code    text NOT NULL,
  school_code  text,
  school_name  text,
  available    integer NOT NULL DEFAULT 0,
  counted      numeric(12,2),
  packed_out   numeric(12,2),
  snapshot_at  timestamptz,
  match_kind   text NOT NULL DEFAULT 'sku',
  synced_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ground_stock_sync_item_code_idx ON ground_stock_sync (item_code);

CREATE TABLE IF NOT EXISTS ground_stock_sync_runs (
  id               bigserial PRIMARY KEY,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  ok               boolean NOT NULL DEFAULT false,
  trigger          text NOT NULL DEFAULT 'cron',
  rows_fetched     integer NOT NULL DEFAULT 0,
  item_codes       integer NOT NULL DEFAULT 0,
  matched          integer NOT NULL DEFAULT 0,
  unmatched        integer NOT NULL DEFAULT 0,
  changed          integer NOT NULL DEFAULT 0,
  cleared          integer NOT NULL DEFAULT 0,
  error            text,
  unmatched_sample jsonb
);

CREATE INDEX IF NOT EXISTS ground_stock_sync_runs_started_idx ON ground_stock_sync_runs (started_at DESC);
