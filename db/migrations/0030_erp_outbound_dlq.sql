-- Phase 4 — outbound queue hardening.
--
-- erp_outbound_dlq is a permanent record of envelopes the drainer
-- gave up on (exhausted retries OR an order disappeared mid-flight).
-- Separating from the main queue keeps "active" rows hot in the
-- index while preserving the dead-letter trail for investigation.

CREATE TABLE IF NOT EXISTS erp_outbound_dlq (
  id              UUID PRIMARY KEY,
  order_id        UUID,
  event_type      TEXT NOT NULL,
  attempts        INTEGER NOT NULL,
  enqueued_at     TIMESTAMPTZ NOT NULL,
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  payload         JSONB,
  dead_lettered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS erp_outbound_dlq_order_idx
  ON erp_outbound_dlq (order_id, dead_lettered_at DESC);
CREATE INDEX IF NOT EXISTS erp_outbound_dlq_dead_lettered_at_idx
  ON erp_outbound_dlq (dead_lettered_at DESC);
