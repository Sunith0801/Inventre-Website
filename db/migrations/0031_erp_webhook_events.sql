-- Phase 5 — receiver-side webhook event log + dedup.
--
-- erp_webhook_events records every inbound POST from the ERP-side
-- dispatcher with its HMAC-verified event_id so duplicate deliveries
-- (network retries, ERP at-least-once semantics) are upsert-safe.
-- Each row's body + processed_at lets us replay or audit a delivery.

CREATE TABLE IF NOT EXISTS erp_webhook_events (
  event_id        TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  resource_name   TEXT,
  payload         JSONB NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'received',
  processing_error  TEXT
);

CREATE INDEX IF NOT EXISTS erp_webhook_events_received_at_idx
  ON erp_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS erp_webhook_events_resource_idx
  ON erp_webhook_events (resource_name, received_at DESC)
  WHERE resource_name IS NOT NULL;
