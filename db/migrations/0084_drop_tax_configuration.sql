-- Remove the Tax Configuration (GST) module (2026-09-15).
--
-- `tax_rates` and `hsn_codes` were only ever read by the admin page that
-- listed them. Nothing at checkout, in invoicing or in the GST reports used
-- them: prices arrive GST-inclusive from ERPNext, invoices copy the HSN code
-- typed on each product (`products.hsn_code`, which stays), and
-- `products.tax_rate_id` was never populated. The list was a reference
-- table with seven rows while products used ~30 other codes.

ALTER TABLE products DROP COLUMN IF EXISTS tax_rate_id;
DROP TABLE IF EXISTS hsn_codes;
DROP TABLE IF EXISTS tax_rates;

DELETE FROM admin_role_permissions WHERE permission IN ('tax.read', 'tax.write');
DELETE FROM admin_user_permissions WHERE permission IN ('tax.read', 'tax.write');
