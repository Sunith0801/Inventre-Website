-- Buffer table that sits between Inventre checkout and the ERP push.
-- Checkout INSERTs into this table; the drain worker pulls rows whose
-- scheduled_for has passed and POSTs them to ERP via /api/ecom/ingest.
--
-- Decoupling rationale:
--   * Checkout never blocks on ERP availability.
--   * The 3-minute (configurable) buffer absorbs late corrections
--     (address fixes, cancellations) before they hit ERP.
--   * Failed pushes are bounded by attempts and surface in the admin UI
--     for manual replay — never silently lost.

CREATE TABLE IF NOT EXISTS erp_outbound_queue (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        uuid          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_type      text          NOT NULL CHECK (event_type IN
                                    ('order.created','order.updated',
                                     'payment.updated','order.cancelled')),
    enqueued_at     timestamptz   NOT NULL DEFAULT now(),
    scheduled_for   timestamptz   NOT NULL,
    attempts        integer       NOT NULL DEFAULT 0,
    last_attempt_at timestamptz,
    last_error      text,
    delivery_id     bigint        REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
    status          text          NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','sending','sent','failed','cancelled'))
);

-- Hot read path: drain ticks scan WHERE status='pending' AND scheduled_for <= now()
CREATE INDEX IF NOT EXISTS erp_outbound_queue_ready_idx
    ON erp_outbound_queue (scheduled_for)
    WHERE status = 'pending';

-- For per-order admin views and the enqueue-order traversal.
CREATE INDEX IF NOT EXISTS erp_outbound_queue_order_idx
    ON erp_outbound_queue (order_id, enqueued_at);

-- For the stuck-`sending` recovery sweep.
CREATE INDEX IF NOT EXISTS erp_outbound_queue_sending_idx
    ON erp_outbound_queue (last_attempt_at)
    WHERE status = 'sending';
