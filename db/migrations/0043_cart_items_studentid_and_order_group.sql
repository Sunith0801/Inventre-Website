-- 0043 — Per-student cart binding + multi-sibling checkout group (2026-05-27)
--
-- Two columns. They unblock:
--   1. Cart UI that groups items by which sibling each item is for
--      (`cart_items.student_id`). Populated on add by the active student
--      on the parent's shop context.
--   2. Multi-sibling checkout that creates ONE order per student (so each
--      school sees a single, unambiguous order) while still linking the
--      sibling orders together with a shared `order_group_id` for the
--      parent's account view + a single CCAvenue capture.
--
-- Both columns are nullable to keep existing carts and orders valid.
-- Indexes are non-unique because multiple items can map to the same
-- (cart, student) and multiple orders to the same group.

ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES students(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cart_items_student_idx
  ON cart_items(student_id) WHERE student_id IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_group_id uuid;

CREATE INDEX IF NOT EXISTS orders_order_group_idx
  ON orders(order_group_id) WHERE order_group_id IS NOT NULL;
