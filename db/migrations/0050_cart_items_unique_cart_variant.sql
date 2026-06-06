-- 0050 — Atomic uniqueness for cart_items rows (2026-06-06)
--
-- Symptom: parents in SAMYU / Samyuktha reported items "dropping" from
-- the cart and ended up rapid-clicking Add, which produced duplicate
-- (cart_id, variant_id) rows. Investigation found `mirrorWriteToDb`
-- (lib/repos/cart.ts) did a non-atomic SELECT → INSERT/UPDATE with no
-- unique constraint to serialise concurrent POSTs. Two simultaneous adds
-- both saw "no existing row" and both inserted — visible right now for
-- parent 973ea549-… (cart_id `162a7d93-…`) where SAM Belt size XL has
-- two rows added 2 ms apart with qty=1 and qty=2.
--
-- Fix: collapse existing duplicates (keep the row with the highest qty,
-- then the most recent added_at) and add a unique index so future
-- concurrent inserts collide cleanly. The application layer is updated
-- to use INSERT … ON CONFLICT DO UPDATE so the upsert is one statement.
--
-- The Redis hash (which uses atomic hincrby) remains the source of
-- truth for qty; the cleanup keeps the row with the highest observed qty
-- so the DB mirror at least matches one of the racing writes.

BEGIN;

-- 1) De-duplicate. For every (cart_id, variant_id) group with > 1 row,
--    keep the row with the highest qty (ties broken by latest added_at)
--    and delete the rest.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY cart_id, variant_id
      ORDER BY qty DESC, added_at DESC, id
    ) AS rn
  FROM cart_items
)
DELETE FROM cart_items
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Add the unique index. Use CREATE UNIQUE INDEX (not a table constraint)
--    so the application's INSERT … ON CONFLICT (cart_id, variant_id) can
--    reference it by columns.
CREATE UNIQUE INDEX IF NOT EXISTS cart_items_cart_variant_uq
  ON cart_items (cart_id, variant_id);

COMMIT;
