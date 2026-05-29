-- Phase 1a — delta-poll watermarks.
--
-- One row per ERP resource the bridge syncs incrementally. The poller
-- reads last_modified_seen, asks ERP for rows modified after that
-- timestamp, and advances the watermark after a successful batch.
-- Replaces the per-order GET loop in lib/erp-poll.ts.

CREATE TABLE IF NOT EXISTS erp.sync_state (
  resource             TEXT PRIMARY KEY,
  last_modified_seen   TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ,
  last_run_status      TEXT,
  last_error           TEXT,
  rows_synced_total    BIGINT NOT NULL DEFAULT 0,
  rows_synced_last_run INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed expected resources so the admin UI shows a row even before the
-- first run, and so UPSERT-on-conflict paths have a target.
INSERT INTO erp.sync_state (resource) VALUES
  ('orders'),
  ('shipments'),
  ('packing_units'),
  ('items'),
  ('customers'),
  ('students')
ON CONFLICT (resource) DO NOTHING;
