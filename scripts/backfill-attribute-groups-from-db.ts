/* eslint-disable no-console */
/**
 * Heal `products.attribute_groups` (and `product_attribute_bindings`) for
 * every template product that has variant-attribute rows in the DB. Driven
 * by `product_variant_attributes` — no CSV input needed.
 *
 * Use this for products imported from ERPNext where the Item Variant
 * structure is already in the DB but the denormalised attribute_groups
 * column was never written. The older scripts/backfill-attribute-groups.ts
 * is a CSV-driven sibling for color+size uniform products; this one
 * covers multi-axis bookkits (and any other DB-resident variant template).
 *
 *   npx tsx scripts/backfill-attribute-groups-from-db.ts            # all
 *   npx tsx scripts/backfill-attribute-groups-from-db.ts --product=<uuid>
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { refreshProductAttributeGroups } from "../server/repos/product-attribute-groups";

async function main() {
  const args = process.argv.slice(2);
  const oneId = args.find((a) => a.startsWith("--product="))?.split("=")[1];

  const result = await db.execute(sql`
    SELECT DISTINCT pv.product_id AS id, p.name
      FROM product_variant_attributes pva
      JOIN product_variants pv ON pv.id = pva.variant_id
      JOIN products p ON p.id = pv.product_id
     ${oneId ? sql`WHERE pv.product_id = ${oneId}` : sql``}
     ORDER BY p.name ASC
  `);
  const list = (Array.isArray(result)
    ? result
    : (result as { rows?: unknown[] }).rows ?? []) as Array<{
    id: string;
    name: string | null;
  }>;

  console.log(`[backfill-from-db] ${list.length} template(s) to refresh`);

  let done = 0, multi = 0, single = 0, empty = 0;
  for (const row of list) {
    const groups = await refreshProductAttributeGroups(row.id);
    if (groups.length === 0) empty++;
    else if (groups.length > 1) multi++;
    else single++;
    done++;
    if (done % 50 === 0) console.log(`  ...${done}/${list.length}`);
  }

  console.log(
    `\n[backfill-from-db] done — ${done} refreshed (${multi} multi-axis, ${single} single-axis, ${empty} cleared)`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
