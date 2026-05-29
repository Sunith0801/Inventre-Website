ALTER TABLE products
  ADD COLUMN IF NOT EXISTS country_of_origin text,
  ADD COLUMN IF NOT EXISTS customs_tariff_number text;
