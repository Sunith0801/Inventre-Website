-- Pricing step: "new base price from <date>". The price the storefront
-- charges stays `base_price` until the date arrives; a cron promotes the
-- scheduled figure (and the default-price-list rows) that morning, so
-- `price_effective_from` is enforced rather than merely recorded.
ALTER TABLE products ADD COLUMN IF NOT EXISTS scheduled_base_price integer;
CREATE INDEX IF NOT EXISTS products_scheduled_price_idx
  ON products (price_effective_from)
  WHERE scheduled_base_price IS NOT NULL;
