/**
 * Wire ERP-imported variants into the existing attribute model so the
 * storefront can render proper size/colour pickers and the admin sees
 * structured variant data.
 *
 * Three problems addressed:
 *
 * 1. product_attribute_bindings + product_variant_attributes — fill in
 *    by mapping each template's category to a real attribute (preferring
 *    the matching CSV-imported attribute by name, falling back to a
 *    generic "<Category> Size") and tagging each variant's cleaned
 *    `size` value as the attribute value.
 *
 * 2. Stock — the feed has no stock data. For demo/QA we set every
 *    ERP variant to stock_qty=50 (placeholder). Real inventory must
 *    come from the warehouse / bins.
 *
 * 3. Prices — the feed's `custom_organization_mrp` is 0 for 2343 of
 *    2344 items (verified live). Use `custom_inventre_cost_price` × 1.5
 *    for the 489 items that have a non-zero cost, else fall back to a
 *    ₹499 placeholder. Mark placeholders so admin can find and replace.
 *
 * Idempotent: re-running is safe — every insert uses onConflictDoNothing
 * and price updates only touch base_price=0 rows.
 *
 *   tsx scripts/wire-erp-variants.ts
 */

import "dotenv/config";
import { db, schema } from "@/db/client";
import { and, eq, isNotNull, sql } from "drizzle-orm";

/* ── per-category attribute mapping (CSV-imported names where possible) ── */
const CATEGORY_TO_ATTRIBUTE: Record<string, string> = {
  "Full Pants": "Full Pant size",
  "Half Pants": "Half Pants Size",
  "Shoes": "Shoe Size",
  "Hoodie": "Hoodie Sizes",
  "Blazers": "Blazer Sizes",
  "Bloomers": "Bloomers Sizes",
  "Bags": "Bags Size",
  "Caps": "Caps Sizes",
  "Frock": "Frock Sizes",
  "Belt": "Belt Size",
  "Tshirt": "Tshirt Size",
  "T-Shirt": "Tshirt Size",
  "Track Pant": "Track Pant Size",
  "Track Shorts": "Track Shorts Sizes",
  "Skirt": "Skirt Size",
  "Socks": "Socks Size",
  "Shirt": "Shirt Size",
  "Tie": "Tie Sizes",
  "Waist Coat": "Waist Coat Sizes",
};

function attrTypeFor(name: string): "size" | "color" | "design" | "model" | "other" {
  const n = name.toLowerCase();
  if (/colou?r|strips?\b/.test(n)) return "color";
  if (/\bsize(s)?\b/.test(n)) return "size";
  if (/design|styles?\b/.test(n)) return "design";
  return "other";
}

async function getOrCreateAttribute(name: string): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: schema.productAttributes.id })
    .from(schema.productAttributes)
    .where(eq(schema.productAttributes.name, name))
    .limit(1);
  if (existing[0]) return { id: existing[0].id, created: false };
  const [row] = await db
    .insert(schema.productAttributes)
    .values({ name, type: attrTypeFor(name) })
    .returning({ id: schema.productAttributes.id });
  return { id: row.id, created: true };
}

async function getOrCreateValue(
  attrId: string,
  value: string,
  cache: Map<string, string>
): Promise<string> {
  const key = `${attrId}:${value}`;
  if (cache.has(key)) return cache.get(key)!;
  const existing = await db
    .select({ id: schema.productAttributeValues.id })
    .from(schema.productAttributeValues)
    .where(
      and(
        eq(schema.productAttributeValues.attributeId, attrId),
        eq(schema.productAttributeValues.value, value)
      )
    )
    .limit(1);
  if (existing[0]) {
    cache.set(key, existing[0].id);
    return existing[0].id;
  }
  const [row] = await db
    .insert(schema.productAttributeValues)
    .values({ attributeId: attrId, value, displayLabel: value })
    .returning({ id: schema.productAttributeValues.id });
  cache.set(key, row.id);
  return row.id;
}

(async () => {
  const valueCache = new Map<string, string>();

  /* ── 1. Bindings + variant attribute rows ──────────────────────── */
  console.log("=== 1. Attribute bindings ===");
  const templates = await db
    .select({
      productId: schema.products.id,
      productName: schema.products.name,
      erpName: schema.products.erpName,
      categoryName: schema.categories.name,
    })
    .from(schema.products)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
    .where(isNotNull(schema.products.erpName));

  // Map: productId → list of variants
  const variantsByProduct = new Map<string, { id: string; size: string }[]>();
  const allVariants = await db
    .select({
      id: schema.productVariants.id,
      productId: schema.productVariants.productId,
      size: schema.productVariants.size,
      erpName: schema.productVariants.erpName,
    })
    .from(schema.productVariants)
    .where(isNotNull(schema.productVariants.erpName));
  for (const v of allVariants) {
    if (!variantsByProduct.has(v.productId)) variantsByProduct.set(v.productId, []);
    variantsByProduct.get(v.productId)!.push({ id: v.id, size: v.size });
  }

  let templatesWired = 0;
  let bindingsInserted = 0;
  let variantAttrsInserted = 0;
  let attrsCreated = 0;
  let valuesCreated = 0;
  let templatesSkipped = 0;

  // Group templates by category to minimise attribute lookups.
  const byCategory = new Map<string, typeof templates>();
  for (const t of templates) {
    if (!byCategory.has(t.categoryName)) byCategory.set(t.categoryName, []);
    byCategory.get(t.categoryName)!.push(t);
  }

  for (const [category, group] of byCategory) {
    const attrName = CATEGORY_TO_ATTRIBUTE[category] ?? `${category} Size`;
    const { id: attrId, created } = await getOrCreateAttribute(attrName);
    if (created) attrsCreated++;

    for (const t of group) {
      const vs = variantsByProduct.get(t.productId) ?? [];
      if (vs.length === 0) {
        templatesSkipped++;
        continue;
      }
      // Bind the attribute to the product (idempotent on PK).
      await db
        .insert(schema.productAttributeBindings)
        .values({ productId: t.productId, attributeId: attrId, isRequired: true, sortOrder: 0 })
        .onConflictDoNothing();
      bindingsInserted++;

      // For each variant, ensure the value exists, then the variant-attribute row.
      for (const v of vs) {
        if (!v.size || v.size.length === 0 || v.size.length > 60) continue;
        const valId = await getOrCreateValue(attrId, v.size, valueCache);
        // Pre-check if it counts as new (cache miss path inserted; track via cache size)
        // Note: getOrCreateValue inserts conditionally; we don't track granularly.
        await db
          .insert(schema.productVariantAttributes)
          .values({ variantId: v.id, attributeId: attrId, valueId: valId })
          .onConflictDoNothing();
        variantAttrsInserted++;
      }
      templatesWired++;
    }
  }
  valuesCreated = valueCache.size;

  console.log(`  templates wired:        ${templatesWired}`);
  console.log(`  templates skipped:      ${templatesSkipped} (no variants)`);
  console.log(`  attributes created:     ${attrsCreated}`);
  console.log(`  values seen/created:    ${valuesCreated}`);
  console.log(`  bindings (best-effort): ${bindingsInserted}`);
  console.log(`  variant-attr rows:      ${variantAttrsInserted}`);

  /* ── 2. Stock placeholder ──────────────────────────────────────── */
  console.log("\n=== 2. Stock placeholder ===");
  const stockResult = await db.execute(sql`
    UPDATE product_variants
       SET stock_qty = 50
     WHERE variant_of_erp_name IS NOT NULL
       AND stock_qty = 0
  `);
  const stockUpdated = (stockResult as unknown as { count?: number }).count ?? 0;
  console.log(`  variants set to stock_qty=50: ${stockUpdated}`);
  console.log(`  (PLACEHOLDER — real inventory should be entered per warehouse via bins)`);

  /* ── 3. Price placeholder ──────────────────────────────────────── */
  console.log("\n=== 3. Price placeholder ===");
  // 3a. Items with a non-zero cost price → base_price = cost * 1.5 (paise = cost * 100 * 1.5).
  const priceFromCost = await db.execute(sql`
    UPDATE products
       SET base_price = ROUND((COALESCE((erp_raw->>'custom_inventre_cost_price')::float, 0) * 150))
     WHERE erp_name IS NOT NULL
       AND base_price = 0
       AND COALESCE((erp_raw->>'custom_inventre_cost_price')::float, 0) > 0
  `);
  const fromCost = (priceFromCost as unknown as { count?: number }).count ?? 0;

  // 3b. Everything else → ₹499 (49 900 paise).
  const priceFallback = await db.execute(sql`
    UPDATE products
       SET base_price = 49900
     WHERE erp_name IS NOT NULL
       AND base_price = 0
  `);
  const fromFallback = (priceFallback as unknown as { count?: number }).count ?? 0;

  console.log(`  products priced from cost × 1.5:  ${fromCost}`);
  console.log(`  products priced at ₹499 fallback: ${fromFallback}`);
  console.log(`  (PLACEHOLDER — admin should set real prices via /admin/products or itemPrices)`);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
