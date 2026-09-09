/* eslint-disable no-console */
/**
 * Tags every products row whose item code appears as an ERPNext variant
 * (i.e. has "Variant Of" set in Item (1).csv). Idempotent.
 *
 * For reference: as of 2026-05-18 there are zero matches in the DB because
 * the ERP item-feed importer already filters variants out. This script is
 * defensive — future imports may not filter, so we keep the catalog clean
 * regardless.
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
  const csvPath = path.resolve(process.cwd(), "data/imports/Item (1).csv");
  if (!fs.existsSync(csvPath)) {
    console.error("Missing Item (1).csv");
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const hdr = rows[0];
  const ixCode = hdr.indexOf("Item Code");
  const ixVarOf = hdr.indexOf("Variant Of");

  const variantCodes = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = r[ixCode]?.trim();
    const varOf = r[ixVarOf]?.trim();
    if (code && varOf) variantCodes.add(code.toLowerCase());
  }
  console.log(`Item.csv variants: ${variantCodes.size}`);

  // Reset flag first so re-running with a smaller variant set won't leave stale tags
  await db.execute(sql`UPDATE products SET is_variant_item = false`);

  let tagged = 0;
  const arr = [...variantCodes];
  for (const code of arr) {
    const res = (await db.execute(sql`
      UPDATE products SET is_variant_item = true
       WHERE lower(name) = ${code} OR lower(erp_name) = ${code}
    `)) as unknown as { count?: number };
    tagged += res.count ?? 0;
  }
  console.log(`Tagged ${tagged} products as is_variant_item=true`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
