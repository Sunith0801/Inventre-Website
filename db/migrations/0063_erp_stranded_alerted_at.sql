-- Track when a stranded-order alert was last sent for each order.
-- Lets the hourly cron skip orders it already emailed within the cooldown
-- window (default 23 h) so ops aren't spammed for the same stuck order.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS erp_stranded_alerted_at TIMESTAMPTZ;
