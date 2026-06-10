-- 0057 — Per-item exchange reasons on return_items (2026-06-09)
--
-- Today every component-level exchange detail (reason, sub-reason, damage
-- location, replacement mode, requested variant, requested component
-- path, notes) lives only on the parent `returns` row. That forced one
-- return row per component when a customer flagged multiple components
-- on the same order_item (Magic-Box / kit) — which then collided with
-- the per-orderItem "already in progress" check.
--
-- After this migration:
--   • A single `returns` row can carry many `return_items`, each with
--     its own reason / sub-reason / replacement choice.
--   • `returns.reason` remains the "primary" reason (= first item's
--     reason) for backwards-compat with audit-side CC queue list.
--   • All columns are nullable; legacy rows stay readable.

ALTER TABLE return_items
  ADD COLUMN IF NOT EXISTS sub_reason              text,
  ADD COLUMN IF NOT EXISTS damage_location         text,
  ADD COLUMN IF NOT EXISTS replacement_mode        text,
  ADD COLUMN IF NOT EXISTS requested_variant_id    uuid REFERENCES product_variants(id),
  ADD COLUMN IF NOT EXISTS requested_component_path jsonb,
  ADD COLUMN IF NOT EXISTS notes                   text;
