-- Attribute groups for the PDP picker (e.g. {Uniform Colors: [Red,Green,...],
-- Shirt Size: [28,30,...]}). Stored denormalised on the template product
-- so the PDP doesn't need to walk Item.csv at request time.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS attribute_groups jsonb;
