-- In-progress PDP / Magic Box selection state, persisted per
-- (parent, product, student) so a parent can navigate away (or even
-- logout / log back in) and have their picks restored.
--
-- The cart is the committed equivalent — this table is the "before they
-- pressed Add to cart" buffer. We keep a single row per key and overwrite
-- as the user makes new selections; on successful Add-to-Cart, the
-- corresponding row is deleted. student_id is nullable because parents
-- with no linked student (rare, transient) can still be authoring picks
-- for the first time.
CREATE TABLE IF NOT EXISTS product_drafts (
  parent_id   uuid NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  student_id  uuid NULL     REFERENCES students(id) ON DELETE CASCADE,
  state       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- (parent, product, student) uniqueness. PostgreSQL treats NULL as
-- distinct in unique indexes, so we use COALESCE with a sentinel UUID
-- to collapse all "no student selected" rows for the same parent+product
-- into one slot.
CREATE UNIQUE INDEX IF NOT EXISTS product_drafts_pkey
  ON product_drafts (
    parent_id,
    product_id,
    COALESCE(student_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS product_drafts_parent_idx
  ON product_drafts (parent_id);
