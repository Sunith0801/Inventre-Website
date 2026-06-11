-- Colour-tagged product images: lets an image declare "I am the Blue one"
-- by pointing at a product_attribute_values row. The PDP gallery surfaces
-- matching images when the shopper picks that colour. Coarser than the
-- existing variant_id column on purpose — one photo covers every size of
-- a colour.
ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS attribute_value_id uuid
    REFERENCES product_attribute_values(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS images_attribute_value_idx
  ON product_images (attribute_value_id);
