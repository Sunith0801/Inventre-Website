-- Per-product free-text note shown directly under the product image on the
-- storefront PDP (left column). Optional; NULL/empty renders nothing.
-- Editable in admin → product → Content tab → "Note under image".
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_note text;
