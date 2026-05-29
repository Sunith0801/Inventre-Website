-- 0036 — orders.coupon_id reservation column + audit-table backfill (2026-05-27)
--
-- Why:
--   Today recordCouponUsage() fires at order placement (create-order route),
--   so a one-time-use coupon is consumed even when CCAvenue rejects the
--   payment. Per spec the consumption must move to the payment-success path
--   in lib/ccavenue-finalize.ts, and the coupon must remain reusable while
--   the order's payment is still pending OR if it ultimately fails.
--
--   To stop two parents from draining the same one-time code in the gap
--   between place-order and pay-success, the order itself reserves the
--   coupon via a new orders.coupon_id column. The reserve-on-placement
--   validator (extended in apply-coupon route) blocks new applications
--   while a pending order with that coupon_id was placed within the last
--   30 minutes — covers the natural CCAvenue session lifetime without
--   locking a code indefinitely if the parent abandons checkout.
--
--   The website_cart_coupon_usages row is now inserted ONLY in the paid
--   path of finalizeOrderPayment(), via the new orders.coupon_id pointer.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + the
-- backfill UPDATE is bounded by `WHERE o.coupon_id IS NULL`, so re-running
-- this migration is a no-op once applied.

-- ── 1. Add the reservation column ────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_id uuid
    REFERENCES website_cart_coupons(id) ON DELETE SET NULL;

-- ── 2. Partial index on the populated rows ───────────────────────────
CREATE INDEX IF NOT EXISTS orders_coupon_id_idx
  ON orders (coupon_id) WHERE coupon_id IS NOT NULL;

-- ── 3. Backfill from existing usages so the audit join keeps working ─
-- Every paid order that already has a website_cart_coupon_usages row
-- gets its orders.coupon_id stamped, so the new detail-page LEFT JOIN
-- (orders → students → schools) renders the same legacy redemptions
-- enriched with student/school info instead of looking unlinked.
UPDATE orders o
   SET coupon_id = u.coupon_id
  FROM website_cart_coupon_usages u
 WHERE u.order_id = o.id
   AND o.coupon_id IS NULL;

ANALYZE orders;
