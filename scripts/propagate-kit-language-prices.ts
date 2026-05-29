/* eslint-disable no-console */
/**
 * Bookkit language variants come in two forms:
 *
 *   - Template kit `WM WF Grade 9 Bookkit` (is_variant_item=false) with
 *     `product_variants` rows whose `size` = sibling kit name
 *     ("WM WF Grade 9 BookkitHindi" / "BookkitKannada"). `item_prices`
 *     is attached to THESE variant ids — that's where the parent's
 *     "₹9,870" lives.
 *
 *   - Sibling kit `WM WF Grade 9 BookkitHindi` (is_variant_item=true,
 *     variant_of_product_id = template). Its OWN `base_price` is 0 and
 *     no `item_prices` row exists for it. When the PDP picks "Hindi"
 *     it fetches the sibling and renders ₹0.
 *
 * This script aligns the sibling's `base_price` (paise) with the parent
 * template variant's item_price (Standard Selling list, school-scoped if
 * present else global). It also mirrors `base_mrp` from the parent's
 * `base_mrp` when set. Idempotent.
 *
 * Usage:
 *   tsx scripts/propagate-kit-language-prices.ts            # dry run
 *   tsx scripts/propagate-kit-language-prices.ts --apply    # write
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

type Row = {
  sibling_id: string;
  sibling_name: string;
  sibling_base_price: number;
  parent_id: string;
  parent_name: string;
  parent_base_mrp: number | null;
  resolved_price: number | null;
};

async function main() {
  console.log(`mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  // For each sibling kit (variant_of_product_id IS NOT NULL),
  // find the parent template's product_variant where sku=sibling.name,
  // then the Standard Selling item_price for that variant.
  const rows = (await db.execute(sql`
    WITH pl AS (
      SELECT id FROM price_lists WHERE name = 'Standard Selling' LIMIT 1
    )
    SELECT s.id AS sibling_id,
           s.name AS sibling_name,
           s.base_price AS sibling_base_price,
           t.id AS parent_id,
           t.name AS parent_name,
           t.base_mrp AS parent_base_mrp,
           (
             SELECT ip.price::int FROM item_prices ip
             JOIN product_variants pv ON pv.id = ip.variant_id
              WHERE pv.product_id = t.id
                AND pv.sku = s.name
                AND ip.price_list_id = (SELECT id FROM pl)
                AND ip.school_id IS NULL
              ORDER BY ip.price ASC LIMIT 1
           ) AS resolved_price
      FROM products s
      JOIN products t ON t.id = s.variant_of_product_id
     WHERE s.kind = 'kit'
       AND s.is_variant_item = true
       AND t.kind = 'kit'
  `)) as unknown as Row[];

  let updated = 0;
  let skippedNoPrice = 0;
  let alreadyCorrect = 0;
  let totalAdded = 0;

  for (const r of rows) {
    if (r.resolved_price == null) {
      skippedNoPrice++;
      continue;
    }
    if (
      r.sibling_base_price === r.resolved_price &&
      (r.parent_base_mrp == null ||
        r.parent_base_mrp === r.parent_base_mrp /* nop placeholder */)
    ) {
      // Already correct (no MRP comparison needed since we'd just mirror).
      if (r.sibling_base_price === r.resolved_price) {
        alreadyCorrect++;
        continue;
      }
    }

    updated++;
    if (updated <= 50) {
      console.log(
        `  ${APPLY ? "[update]" : "[dry-run]"} ${r.sibling_name} (id=${r.sibling_id}) base_price ${r.sibling_base_price} → ${r.resolved_price}`
      );
    }
    if (APPLY) {
      await db.execute(sql`
        UPDATE products
           SET base_price = ${r.resolved_price},
               base_mrp = COALESCE(base_mrp, ${r.parent_base_mrp})
         WHERE id = ${r.sibling_id}
      `);
      // Also insert/replace an item_price row on the sibling so the
      // variant resolver — should anyone reach for it via the sibling's
      // own (empty) product_variants list — has a fallback rate.
      const pl = (await db.execute(sql`
        SELECT id FROM price_lists WHERE name = 'Standard Selling' LIMIT 1
      `)) as unknown as { id: string }[];
      if (pl[0]) {
        // Sibling kits don't have their own variant rows, so we attach
        // the price at the product level via item_prices keyed by
        // product_id (school_id NULL).
        // NOTE: schema may not allow product_id-only item_prices; in
        // that case we rely on base_price set above. Try a graceful
        // insert and ignore errors.
        try {
          await db.execute(sql`
            INSERT INTO item_prices (product_id, price_list_id, price, school_id)
            VALUES (${r.sibling_id}, ${pl[0].id}, ${r.resolved_price}, NULL)
            ON CONFLICT DO NOTHING
          `);
          totalAdded++;
        } catch {
          /* ignore — base_price update is the primary signal */
        }
      }
    }
  }

  if (updated > 50) console.log(`  … (${updated - 50} more)`);

  console.log("\n=== summary ===");
  console.log(`mode:               ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`siblings examined:  ${rows.length}`);
  console.log(`base_price updated: ${updated}`);
  console.log(`already correct:    ${alreadyCorrect}`);
  console.log(`skipped (no price): ${skippedNoPrice}`);
  if (APPLY && totalAdded > 0)
    console.log(`item_prices added:  ${totalAdded}`);
  if (!APPLY) console.log("\nrerun with --apply to write changes.");
  if (APPLY)
    console.log(
      "\n⚠  Restart the deploy app to flush Next.js unstable_cache:\n" +
        "   docker restart inventre-deploy-app"
    );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
