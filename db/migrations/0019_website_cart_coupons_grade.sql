-- Optional grade scope on Website Cart Coupons. Local-only — ERPNext's
-- doctype has no grade field, so this is not pushed/pulled. Used at
-- cart-apply time to restrict a coupon to one grade of the linked school.
ALTER TABLE website_cart_coupons
  ADD COLUMN IF NOT EXISTS grade TEXT;

CREATE INDEX IF NOT EXISTS website_cart_coupons_grade_idx
  ON website_cart_coupons (grade);
