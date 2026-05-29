-- Columns the ERP poll worker keys off of.
--   erp_so_name        — set when /api/ecom/ingest returns the ERP-side sales-order name.
--   erp_last_polled_at — bumped each time the poll worker fetches this order.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS erp_so_name        text,
    ADD COLUMN IF NOT EXISTS erp_last_polled_at timestamptz;

CREATE INDEX IF NOT EXISTS orders_erp_so_name_idx
    ON orders (erp_so_name)
    WHERE erp_so_name IS NOT NULL;

-- The poll worker scans for open orders that have been pushed to ERP.
CREATE INDEX IF NOT EXISTS orders_poll_candidates_idx
    ON orders (status, erp_so_name)
    WHERE erp_so_name IS NOT NULL
      AND status NOT IN ('delivered','cancelled','returned');
