/* eslint-disable no-console */
/**
 * Populates products.variant_of_product_id from Item.csv "Variant Of".
 * Resolves the template name → products.id and updates the row.
 *
 * For variants whose template doesn't exist as a products row (e.g. parent
 * Bookkit not yet imported), the column stays null and the PDP picker will
 * fall back to nothing.
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

async function main() {
  const csvPath = path.resolve(process.cwd(), "Item (1).csv");
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const hdr = rows[0];
  const ixCode = hdr.indexOf("Item Code");
  const ixVarOf = hdr.indexOf("Variant Of");

  // (variant code → template code) pairs
  const pairs: [string, string][] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const c = r[ixCode]?.trim();
    const v = r[ixVarOf]?.trim();
    if (c && v) pairs.push([c, v]);
  }
  console.log(`Item.csv has ${pairs.length} variant→template pairs`);

  // Load all products by lowercase name for resolution
  const prods = (await db.execute(sql`
    SELECT id, name, erp_name FROM products
  `)) as unknown as { id: string; name: string; erp_name: string | null }[];
  const byName = new Map<string, string>();
  for (const p of prods) {
    byName.set(p.name.toLowerCase(), p.id);
    if (p.erp_name) byName.set(p.erp_name.toLowerCase(), p.id);
  }

  let linked = 0;
  let skipped = 0;
  for (const [variantCode, templateCode] of pairs) {
    const variantId = byName.get(variantCode.toLowerCase());
    const templateId = byName.get(templateCode.toLowerCase());
    if (!variantId || !templateId) {
      skipped++;
      continue;
    }
    await db.execute(sql`
      UPDATE products
         SET variant_of_product_id = ${templateId}
       WHERE id = ${variantId}
    `);
    linked++;
  }
  console.log(`Linked ${linked} variants, skipped ${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
