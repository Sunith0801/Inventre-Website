/* eslint-disable no-console */
/**
 * Companion to scripts/backfill-kit-variants.ts. Removes the variant rows
 * inserted by that script. Identifies them by the convention used at insert:
 *   - sku equals the parent product's slug
 *   - size = 'Standard'
 *   - erp_name IS NULL
 *
 * Safe to re-run; nothing happens if there are no rows matching.
 *
 * Use this when ERP sync starts creating real variants for these products
 * and you want to avoid duplicate SKUs accumulating.
 *
 *   DATABASE_URL=... npx tsx scripts/revert-kit-variants-backfill.ts          # dry-run
 *   DATABASE_URL=... npx tsx scripts/revert-kit-variants-backfill.ts --commit
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

const COMMIT = process.argv.includes("--commit");

async function main() {
  // Refuse to delete a backfilled variant that has any downstream
  // dependency (cart line, order item, BOM reference). If a customer
  // already added it to cart or purchased, we keep it.
  const targets = (await db.execute(sql`
    SELECT pv.id, pv.sku
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
     WHERE pv.size = 'Standard'
       AND pv.erp_name IS NULL
       AND pv.sku = p.slug
       AND NOT EXISTS (SELECT 1 FROM cart_items ci WHERE ci.variant_id = pv.id)
       AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = pv.id)
       AND NOT EXISTS (SELECT 1 FROM bundle_components bc WHERE bc.variant_id = pv.id)
       AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.variant_id = pv.id)
  `)) as unknown as { id: string; sku: string }[];

  console.log(`Found ${targets.length} backfilled variants safe to remove.`);

  if (!COMMIT) {
    console.log("DRY RUN. Re-run with --commit to delete.");
    return;
  }
  if (targets.length === 0) return;

  const ids = sql.join(targets.map((t) => sql`${t.id}::uuid`), sql`, `);
  const deleted = (await db.execute(sql`
    DELETE FROM product_variants WHERE id IN (${ids}) RETURNING id
  `)) as unknown as { id: string }[];
  console.log(`Deleted ${deleted.length} rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
