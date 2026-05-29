-- Drain queue index for erp_webhook_events.
--
-- /api/cron/erp-webhook-drain runs this query every 15 seconds:
--   SELECT event_id FROM erp_webhook_events
--    WHERE processing_status = 'received'
--    ORDER BY received_at
--    LIMIT 50 FOR UPDATE SKIP LOCKED
--
-- Without an index keyed by (processing_status, received_at) the scan
-- walks the full table — fine when the queue is short but cripples as
-- the lifetime row count grows (we already have ~tens of thousands of
-- processed events). A partial index restricted to `received` keeps the
-- index tiny since processed rows aren't included.

CREATE INDEX IF NOT EXISTS erp_webhook_events_drain_idx
  ON erp_webhook_events (received_at)
  WHERE processing_status = 'received';
