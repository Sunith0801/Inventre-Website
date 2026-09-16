-- Product creation redesign (2026-09-16).
--
-- 1. Pricing step gains "GST rate" and "effective from". GST configuration
--    (tax_rates) was removed in 0084 because nothing read it; the redesign
--    asks for the rate ON the product, once, as plain data the invoice can
--    quote. Both nullable: existing rows are untouched.
ALTER TABLE products ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_effective_from date;

-- 2. The Book kit sections master list, as categories under one parent.
--    A Book kit item's sub-category and a Book kit's sections are the same
--    list, so items found by the section builder's search are the items
--    filed under that sub-category. Idempotent on slug.
INSERT INTO categories (id, parent_id, slug, name, sort_order, path)
VALUES (gen_random_uuid(), NULL, 'book-kit', 'Book kit', 50, 'book-kit')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (id, parent_id, slug, name, sort_order, path)
SELECT gen_random_uuid(), p.id, s.slug, s.name, s.ord, 'book-kit.' || s.slug
  FROM categories p,
       (VALUES ('book-kit-notebooks',      'Notebooks',      1),
               ('book-kit-text-books',     'Text books',     2),
               ('book-kit-stationery',     'Stationery',     3),
               ('book-kit-activity-books', 'Activity books', 4),
               ('book-kit-drawing',        'Drawing',        5),
               ('book-kit-general',        'General',        6)) AS s(slug, name, ord)
 WHERE p.slug = 'book-kit'
ON CONFLICT (slug) DO NOTHING;
