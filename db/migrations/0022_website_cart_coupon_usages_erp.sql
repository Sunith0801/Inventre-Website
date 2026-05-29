-- Extend website_cart_coupon_usages with the fields needed to mirror the
-- "linked Sales Orders" panel shown by ERPNext on a Website Cart Coupon.
-- Real coupon redemptions today live in ERPNext (Sales Order
-- `custom_cart_coupon_code` + `discount_amount` + `grand_total`); we import
-- them via scripts/import-coupon-usages.ts so the admin page can read
-- everything from the local DB without live ERPNext round-trips.

ALTER TABLE website_cart_coupon_usages
  ADD COLUMN IF NOT EXISTS erp_sales_order   TEXT,
  ADD COLUMN IF NOT EXISTS customer_name     TEXT,
  ADD COLUMN IF NOT EXISTS order_amount      INTEGER,  -- paise; grand_total * 100
  ADD COLUMN IF NOT EXISTS transaction_date  DATE;

-- One usage row per ERPNext Sales Order. Local (storefront) redemptions
-- leave erp_sales_order NULL, so the partial index is appropriate.
CREATE UNIQUE INDEX IF NOT EXISTS website_cart_coupon_usages_erp_so_idx
  ON website_cart_coupon_usages (erp_sales_order)
  WHERE erp_sales_order IS NOT NULL;
