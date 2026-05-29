/* eslint-disable no-console */
/**
 * Re-derive products.attribute_groups from the current variants for every
 * product. The variant admin PATCH does this on save, but past versions
 * lumped all attribute values (including size) into a single "Color"
 * bucket. This script rewrites every row to the corrected shape:
 *
 *   - Size group: distinct product_variants.size values for active variants.
 *   - One group per non-size attribute, named after `product_attributes.name`.
 *
 * Usage:
 *   tsx scripts/recompute-attribute-groups.ts            # dry run
 *   tsx scripts/recompute-attribute-groups.ts --apply    # write
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

type AttrRow = {
  product_id: string;
  attr_id: string;
  attr_name: string;
  attr_type: string;
  attr_sort: number;
  value: string;
  value_sort: number;
};

async function main() {
  console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  // All sizes per product (legacy column on product_variants).
  const sizeRows = (await db.execute(sql`
    SELECT product_id, size
      FROM product_variants
     WHERE is_active = true AND size IS NOT NULL AND size <> ''
  `)) as unknown as { product_id: string; size: string }[];

  const sizesByProduct = new Map<string, string[]>();
  const sizeSeen = new Map<string, Set<string>>();
  for (const r of sizeRows) {
    const seen = sizeSeen.get(r.product_id) ?? new Set<string>();
    if (seen.has(r.size)) continue;
    seen.add(r.size);
    sizeSeen.set(r.product_id, seen);
    const arr = sizesByProduct.get(r.product_id) ?? [];
    arr.push(r.size);
    sizesByProduct.set(r.product_id, arr);
  }

  // All other attribute values per product (Color, Design, Model, …).
  const attrRows = (await db.execute(sql`
    SELECT pv.product_id, pa.id AS attr_id, pa.name AS attr_name,
           pa.type::text AS attr_type, pa.sort_order AS attr_sort,
           pav.value AS value, pav.sort_order AS value_sort
      FROM product_variant_attributes pva
      JOIN product_variants pv ON pv.id = pva.variant_id AND pv.is_active = true
      JOIN product_attributes pa ON pa.id = pva.attribute_id
      JOIN product_attribute_values pav ON pav.id = pva.value_id
     WHERE pa.type::text <> 'size'
  `)) as unknown as AttrRow[];

  type Bucket = {
    name: string;
    attrSort: number;
    values: { value: string; sort: number }[];
    seen: Set<string>;
  };
  type ProductBuckets = Map<string, Bucket>;
  const byProduct = new Map<string, ProductBuckets>();
  for (const r of attrRows) {
    const buckets = byProduct.get(r.product_id) ?? new Map<string, Bucket>();
    const bucket =
      buckets.get(r.attr_id) ??
      { name: r.attr_name, attrSort: r.attr_sort ?? 0, values: [], seen: new Set<string>() };
    if (!bucket.seen.has(r.value)) {
      bucket.seen.add(r.value);
      bucket.values.push({ value: r.value, sort: r.value_sort ?? 0 });
    }
    buckets.set(r.attr_id, bucket);
    byProduct.set(r.product_id, buckets);
  }

  // Per-product size axis name: products with an EAV attribute of type='size'
  // (e.g. "Caps Sizes", "Skirt Size") must use that name as the JSON axis,
  // not the hardcoded "Size", so MultiAttributePicker can look up variants
  // by the same key the EAV stores. Products with no EAV size attribute
  // keep the legacy "Size" label.
  const sizeAxisRows = (await db.execute(sql`
    SELECT DISTINCT pv.product_id, pa.name AS size_axis_name
      FROM product_variant_attributes pva
      JOIN product_variants pv ON pv.id = pva.variant_id AND pv.is_active = true
      JOIN product_attributes pa ON pa.id = pva.attribute_id
     WHERE pa.type::text = 'size'
  `)) as unknown as { product_id: string; size_axis_name: string }[];
  const sizeAxisNameByProduct = new Map<string, string>();
  for (const r of sizeAxisRows) {
    if (!sizeAxisNameByProduct.has(r.product_id)) {
      sizeAxisNameByProduct.set(r.product_id, r.size_axis_name);
    }
  }

  // Fetch every product's current attribute_groups in one shot. We only
  // touch rows whose derived value differs.
  const currentRows = (await db.execute(sql`
    SELECT id, name, attribute_groups FROM products
  `)) as unknown as {
    id: string;
    name: string;
    attribute_groups: unknown;
  }[];

  let written = 0;
  for (const r of currentRows) {
    const sizes = sizesByProduct.get(r.id) ?? [];
    const buckets = byProduct.get(r.id) ?? new Map<string, Bucket>();

    const groups: { name: string; values: string[] }[] = [];
    const sortedBuckets = Array.from(buckets.values()).sort(
      (a, b) => a.attrSort - b.attrSort
    );
    if (sizes.length > 0) {
      // Mirror the admin PATCH route guard. Three cases:
      //   1. EAV size attribute exists → use its name.
      //   2. No EAV size attribute and no other EAV axes → fall back to
      //      "Size" (legacy-only products).
      //   3. No EAV size attribute but other EAV axes exist → skip the size
      //      group; the legacy `size` column likely holds non-size labels
      //      (e.g. sibling product names on bookkit parents) and would
      //      create a phantom unreachable axis.
      const eavSizeName = sizeAxisNameByProduct.get(r.id);
      const sizeAxisName =
        eavSizeName ?? (sortedBuckets.length === 0 ? "Size" : null);
      if (sizeAxisName !== null) {
        groups.push({ name: sizeAxisName, values: sizes });
      }
    }
    for (const g of sortedBuckets) {
      const values = g.values.sort((a, b) => a.sort - b.sort).map((v) => v.value);
      groups.push({ name: g.name, values });
    }

    const next = groups.length > 0 ? groups : null;
    const prev = (r.attribute_groups ?? null) as
      | { name: string; values: string[] }[]
      | null;
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    // Conservative: only repair products that already had attribute_groups
    // populated. Leave NULL rows alone so we don't materialise picker
    // data for products whose attribute_groups was deliberately empty
    // (e.g. magic boxes / bookkits managed via product_attribute_bindings).
    if (prev === null) continue;
    // Only touch rows that came from the regression — the buggy variant
    // PATCH wrote groups named literally "Size" and/or "Color". Curated
    // pickers (kits, bookkits, the hierarchy-panel ones) use product-
    // specific names like "Caps Color", "Belt Size", "Language Selection",
    // and we must not overwrite those.
    const prevNames = new Set(prev.map((g) => g.name));
    const looksLikeRegression =
      prevNames.has("Color") || (prevNames.has("Size") && prev.length <= 2);
    if (!looksLikeRegression) continue;
    // Don't blank out a populated picker — if the recompute can't produce
    // any groups (no active variants), keep what was there. Avoids cases
    // like a soft-archived product losing its curated picker.
    if (next === null && prev && prev.length > 0) continue;

    written++;
    console.log(
      `  ${APPLY ? "[update]" : "[dry-run]"} ${r.name} (id=${r.id}) prev=${JSON.stringify(prev)} next=${JSON.stringify(next)}`
    );
    if (APPLY) {
      await db.execute(sql`
        UPDATE products SET attribute_groups = ${next ? sql`${JSON.stringify(next)}::jsonb` : sql`NULL`}
         WHERE id = ${r.id}
      `);
    }
  }

  console.log("\n=== summary ===");
  console.log(`mode:           ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`products w/Δ:   ${written}`);
  if (!APPLY) console.log("\nrerun with --apply to write changes.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
