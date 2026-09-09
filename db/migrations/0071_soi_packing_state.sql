-- Per-line "held back" signal mirrored from audit's get_order payload.
-- Audit computes `packing_state` per Kit line (and sub-item):
--   'oos'     — an OPEN out-of-stock / damaged / wrong-size deficiency
--   'packed'  — sealed in a unit but not yet dispatched
--   'pending' — order has packing activity but this line was never touched
--                (and its category isn't a delivered whole-parcel)
--   NULL      — dispatched, OR went inside a delivered whole-category parcel
--                (bookkit textbooks, uniform pieces in a "Delivered" parcel)
--
-- Any NON-NULL value means the line is demonstrably NOT delivered yet, even
-- when its category rolled up to "Delivered · N pending". The storefront
-- order page uses this to badge a held-back line "pending" instead of
-- inheriting the category's delivered floor (e.g. SAL-ORD-2026-34537's
-- KLS Half Pants, out_of_stock, while its 5 siblings delivered).
ALTER TABLE erp.sales_order_items
  ADD COLUMN IF NOT EXISTS packing_state TEXT;
