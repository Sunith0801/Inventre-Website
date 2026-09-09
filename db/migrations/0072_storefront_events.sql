-- Storefront failure telemetry.
--
-- lib/observability/record-storefront-event.ts has been INSERTing into this
-- table since the observability helpers landed, and instrumentation.ts's
-- onRequestError hook writes every unhandled 500 here too — but the table was
-- never created by a migration, so it does not exist in any database. The
-- insert sits inside a bare `catch {}` ("never surface telemetry errors to the
-- customer"), so every write has been silently discarded.
--
-- Cost of that: when a parent's exchange submit came back 400 "Invalid
-- request", the zodError detail that says WHICH field was rejected went into
-- the void. Three such 400s on /api/returns (2026-07-30) could not be
-- explained from the server side at all.
--
-- Append-only. Nothing reads it yet except the planned admin
-- "Failures (24h)" panel, so creating it is purely additive.
CREATE TABLE IF NOT EXISTS storefront_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  parent_id   uuid,
  student_id  uuid,
  -- "api.4xx" | "api.5xx" | "rule.block" | "otp.throttle" (see
  -- eventKindForStatus). Deliberately not an enum: the helper accepts any
  -- string and a new kind must never fail the insert.
  kind        text NOT NULL,
  method      text,
  path        text,
  status      integer,
  message     text,
  details     jsonb,
  ip          text,
  ua          text
);

-- The panel's only query shape: recent failures, newest first, optionally
-- narrowed to one endpoint or one parent.
CREATE INDEX IF NOT EXISTS storefront_events_created_at_idx
  ON storefront_events (created_at DESC);
CREATE INDEX IF NOT EXISTS storefront_events_path_created_at_idx
  ON storefront_events (path, created_at DESC);
CREATE INDEX IF NOT EXISTS storefront_events_parent_id_created_at_idx
  ON storefront_events (parent_id, created_at DESC)
  WHERE parent_id IS NOT NULL;
