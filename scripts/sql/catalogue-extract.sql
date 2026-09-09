WITH pr AS (
  SELECT variant_id, min(price) price FROM item_prices GROUP BY variant_id
), sch AS (
  SELECT ps.product_id,
         string_agg(DISTINCT coalesce(s.name,s.school_code), ', ') names,
         string_agg(DISTINCT s.school_code, ',')                   codes
  FROM product_school ps JOIN schools s ON s.id=ps.school_id GROUP BY 1
), g0 AS (
  SELECT DISTINCT product_id, grade,
    CASE lower(trim(grade))
      WHEN 'nursery' THEN 0 WHEN 'lkg' THEN 1 WHEN 'ukg' THEN 2
      ELSE CASE WHEN grade ~* '^grade\s+\d+' THEN 10 + (regexp_match(grade,'^[Gg]rade\s+(\d+)'))[1]::int ELSE 900 END
    END AS rk
  FROM product_grades
), gr AS (
  SELECT product_id, string_agg(grade, ', ' ORDER BY rk, grade) grades FROM g0 GROUP BY 1
), col AS (
  SELECT pva.variant_id, min(coalesce(pav.display_label, pav.value)) colour
  FROM product_variant_attributes pva
  JOIN product_attributes pa ON pa.id=pva.attribute_id AND pa.type='color'
  JOIN product_attribute_values pav ON pav.id=pva.value_id
  GROUP BY 1
), clean AS (
  SELECT v.sku sku, p.name item_name,
         coalesce(sch.names,'') school_name, coalesce(sch.codes,'') school_code,
         coalesce(gr.grades,'') grades, coalesce(c.name,'') category,
         p.kind::text kind, coalesce(v.size,'') size, coalesce(col.colour,'') colour,
         coalesce(pr.price, nullif(p.base_price,0)) price, nullif(p.base_mrp,0) mrp,
         v.is_active active
  FROM product_variants v
  JOIN products p ON p.id=v.product_id
  LEFT JOIN categories c ON c.id=p.category_id
  LEFT JOIN pr ON pr.variant_id=v.id
  LEFT JOIN col ON col.variant_id=v.id
  LEFT JOIN sch ON sch.product_id=p.id
  LEFT JOIN gr ON gr.product_id=p.id
  WHERE coalesce(v.sku,'')<>''
)
SELECT regexp_replace(sku,'[\t\r\n]+',' ','g'), regexp_replace(item_name,'[\t\r\n]+',' ','g'),
       regexp_replace(school_name,'[\t\r\n]+',' ','g'), school_code,
       grades, regexp_replace(category,'[\t\r\n]+',' ','g'), kind,
       regexp_replace(size,'[\t\r\n]+',' ','g'), regexp_replace(colour,'[\t\r\n]+',' ','g'),
       price, mrp, active
FROM clean ORDER BY sku;
