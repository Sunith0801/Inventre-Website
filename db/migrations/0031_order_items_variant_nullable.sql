-- ERPNext-imported orders frequently reference item_codes that don't yet
-- exist in our local product catalog (one-off purchases, deprecated SKUs,
-- newly-listed items not yet synced). The previous behaviour silently
-- dropped these lines, leaving order totals that didn't match the
-- sub-item list. Allow NULL so we can persist the snapshot (name + qty +
-- price + HSN) and let admins fix the variant binding later.
ALTER TABLE order_items
  ALTER COLUMN variant_id DROP NOT NULL;
