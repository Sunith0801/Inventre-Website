/* eslint-disable no-console */
/**
 * Three passes:
 *  1) Set products.variant_attribute + variant_attribute_value from Item.csv
 *  2) Update bundle_components.rate_paise from BOM.csv (Rate (Items) column)
 *  3) Roll the BOM rates up into products.base_mrp for variants (Bookkit
 *     Hindi/Kannada get an MRP = sum of their bundle_components × qty,
 *     transitively).
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import fs from "fs";
import { db } from "../db/client";
import { sql } from "drizzle-orm";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c === "\r") {
        // skip
      } else cell += c;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function pass1Attributes() {
  console.log("PASS 1: variant attribute name/value from Item.csv");
  const rows = parseCsv(
    fs.readFileSync(path.resolve(process.cwd(), "Item (1).csv"), "utf8")
  );
  const hdr = rows[0];
  const ixCode = hdr.indexOf("Item Code");
  const ixAttr = hdr.indexOf("Attribute (Variant Attributes)");
  const ixVal = hdr.indexOf("Attribute Value (Variant Attributes)");

  let updated = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = r[ixCode]?.trim();
    const attr = r[ixAttr]?.trim();
    const val = r[ixVal]?.trim();
    if (!code || (!attr && !val)) continue;
    const res = (await db.execute(sql`
      UPDATE products
         SET variant_attribute = ${attr || null},
             variant_attribute_value = ${val || null}
       WHERE lower(name) = ${code.toLowerCase()}
          OR lower(erp_name) = ${code.toLowerCase()}
    `)) as unknown as { count?: number };
    updated += res.count ?? 0;
  }
  console.log(`  updated ${updated} products with variant_attribute*`);
}

async function pass2Rates() {
  console.log("PASS 2: bundle_components.rate_paise from BOM.csv");
  const rows = parseCsv(
    fs.readFileSync(path.resolve(process.cwd(), "BOM.csv"), "utf8")
  );

  let currentParentName: string | null = null;
  let bundleIdByName: Map<string, string> = new Map();

  // Pre-load product_bundles → product name
  const bundleRows = (await db.execute(sql`
    SELECT pb.id AS bundle_id, p.name AS parent_name
      FROM product_bundles pb JOIN products p ON p.id = pb.product_id
  `)) as unknown as { bundle_id: string; parent_name: string }[];
  for (const b of bundleRows) bundleIdByName.set(b.parent_name.toLowerCase(), b.bundle_id);

  // Pre-load products by name
  const prodRows = (await db.execute(sql`
    SELECT id, name FROM products
  `)) as unknown as { id: string; name: string }[];
  const productIdByName = new Map<string, string>();
  for (const p of prodRows) productIdByName.set(p.name.toLowerCase(), p.id);

  let updated = 0;
  let processed = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 10) continue;
    const id = r[0]?.trim();
    if (id) currentParentName = r[1]?.trim() ?? null;
    if (!currentParentName) continue;

    const childCode = r[7]?.trim();
    const qty = parseFloat(r[8]) || 1;
    const rate = parseFloat(r[9]) || 0;
    if (!childCode) continue;
    processed++;

    if (rate <= 0) continue; // nothing to write
    const ratePaise = Math.round(rate * 100);

    const bundleId = bundleIdByName.get(currentParentName.toLowerCase());
    const childId = productIdByName.get(childCode.toLowerCase());
    if (!bundleId || !childId) continue;

    const res = (await db.execute(sql`
      UPDATE bundle_components
         SET rate_paise = ${ratePaise}
       WHERE bundle_id = ${bundleId}
         AND product_id = ${childId}
         AND qty = ${Math.round(qty)}
    `)) as unknown as { count?: number };
    updated += res.count ?? 0;
  }
  console.log(`  processed ${processed} child rows, updated ${updated} bundle_components`);
}

async function pass3RollupMrp() {
  console.log("PASS 3: roll up MRP from bundle_components recursively");
  // For each variant product (variant_of_product_id IS NOT NULL), compute
  // SUM(rate_paise * qty) over its bundle_components, recursively walking
  // through sub-bundles.
  const variants = (await db.execute(sql`
    SELECT id FROM products WHERE variant_of_product_id IS NOT NULL
  `)) as unknown as { id: string }[];

  let updated = 0;
  for (const v of variants) {
    const sumRows = (await db.execute(sql`
      WITH RECURSIVE walk AS (
        SELECT bc.product_id, bc.qty, bc.rate_paise, 1::int AS depth
          FROM product_bundles pb
          JOIN bundle_components bc ON bc.bundle_id = pb.id
         WHERE pb.product_id = ${v.id}
        UNION ALL
        SELECT bc2.product_id, w.qty * bc2.qty AS qty, bc2.rate_paise, w.depth + 1
          FROM walk w
          JOIN product_bundles pb2 ON pb2.product_id = w.product_id
          JOIN bundle_components bc2 ON bc2.bundle_id = pb2.id
         WHERE w.depth < 6
      )
      SELECT COALESCE(SUM(rate_paise * qty), 0)::bigint AS total FROM walk
    `)) as unknown as { total: string | number }[];
    const totalPaise = Number(sumRows[0]?.total ?? 0);
    if (totalPaise <= 0) continue;
    await db.execute(sql`
      UPDATE products
         SET base_mrp = ${totalPaise},
             base_price = CASE WHEN base_price = 0 THEN ${totalPaise} ELSE base_price END
       WHERE id = ${v.id}
    `);
    updated++;
  }
  console.log(`  updated ${updated} variant products with rolled-up MRP`);
}

async function main() {
  await pass1Attributes();
  await pass2Rates();
  await pass3RollupMrp();
  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
