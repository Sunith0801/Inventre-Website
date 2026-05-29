/* eslint-disable no-console */
/**
 * Migrate Item Prices (price_list = Standard Selling) into itemPrices.
 *
 *   npx tsx scripts/migrate-from-erp/06-prices.ts [--sample=N]
 */

import { erpListPages } from "./_client";
import {
  db,
  shutdown,
  ensureCheckpointTable,
  writeCheckpoint,
  logMigrationError,
  CUTOVER_DATE,
  CUTOVER_ISO,
  DRY_RUN,
  dryRunBanner,
  newDryRunReport,
  recordDryRunDiff,
  diffRows,
  writeDryRunReport,
} from "./_db";
import { itemPrices, productVariants, priceLists } from "../../db/schema";
import { eq } from "drizzle-orm";

const SCRIPT = "06-prices";

type ItemPrice = {
  name: string;
  item_code: string;
  price_list: string;
  price_list_rate: number;
  currency?: string;
  min_qty?: number;
  valid_from?: string | null;
  valid_upto?: string | null;
};

async function main() {
  const sample = Number(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 0);
  await ensureCheckpointTable();
  dryRunBanner(SCRIPT);
  console.log(`\n[${SCRIPT}] migrating Item Prices (Standard Selling)${sample ? ` (sample ${sample})` : ""}\n`);

  const [defaultList] = await db
    .select()
    .from(priceLists)
    .where(eq(priceLists.name, "Standard Selling"))
    .limit(1);
  if (!defaultList) throw new Error("price list 'Standard Selling' not found — run db:seed first");

  let processed = 0, upserts = 0, skipped = 0;
  const report = newDryRunReport(SCRIPT, "Item Price");

  for await (const page of erpListPages<ItemPrice>("Item Price", {
    // min_qty/valid_from/valid_upto restricted on this API key → omit (defaults applied)
    fields: ["name", "item_code", "price_list", "price_list_rate"],
    filters: [["price_list", "=", "Standard Selling"], ["selling", "=", 1]],
    pageSize: 100,
    sample: sample || undefined,
    cutoffIso: CUTOVER_ISO,
    cutoffField: "modified",
  })) {
    for (const p of page) {
      try {
        const variantRow = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.sku, p.item_code))
          .limit(1);
        if (!variantRow[0]) {
          report.counts.unresolved_dependency++;
          await logMigrationError(SCRIPT, "Item Price", p.name, `variant ${p.item_code} not found`);
          skipped++;
          continue;
        }

        const priceP = Math.round(p.price_list_rate * 100);
        const validFrom = p.valid_from ? new Date(p.valid_from) : null;
        const validUntil = p.valid_upto ? new Date(p.valid_upto) : null;

        // Upsert by (variant, list, school=null)
        const existing = await db
          .select()
          .from(itemPrices)
          .where(eq(itemPrices.variantId, variantRow[0].id))
          .limit(1);

        const updatePayload = {
          price: priceP,
          validFrom,
          validUntil,
          minQty: p.min_qty ?? 0,
          updatedAt: new Date(),
        };
        const insertPayload = {
          variantId: variantRow[0].id,
          priceListId: defaultList.id,
          price: priceP,
          minQty: p.min_qty ?? 0,
          validFrom,
          validUntil,
        };

        if (existing[0] && existing[0].createdAt && existing[0].createdAt >= CUTOVER_DATE) {
          // Post-cutover price row (written by live website) — never touch.
          report.counts.would_skip_post_cutover++;
          processed++;
          continue;
        }

        if (DRY_RUN) {
          if (existing[0]) {
            const changed = diffRows(
              existing[0] as unknown as Record<string, unknown>,
              updatePayload as unknown as Record<string, unknown>
            );
            if (changed.length === 0) report.counts.would_skip_unchanged++;
            else report.counts.would_update++;
            recordDryRunDiff(report, {
              key: p.name,
              before: existing[0] as unknown as Record<string, unknown>,
              after: updatePayload as unknown as Record<string, unknown>,
              changedFields: changed,
            });
          } else {
            report.counts.would_insert++;
            recordDryRunDiff(report, {
              key: p.name,
              before: null,
              after: insertPayload as unknown as Record<string, unknown>,
              changedFields: Object.keys(insertPayload),
            });
          }
        } else if (existing[0]) {
          await db
            .update(itemPrices)
            .set(updatePayload)
            .where(eq(itemPrices.id, existing[0].id));
        } else {
          await db.insert(itemPrices).values(insertPayload);
        }
        upserts++;
        processed++;
        if (processed % 100 === 0) {
          console.log(`  progress: ${processed} prices (${upserts} upserts, ${skipped} skipped)`);
          await writeCheckpoint(SCRIPT, processed, p.name);
        }
      } catch (e) {
        report.counts.errored++;
        await logMigrationError(SCRIPT, "Item Price", p.name, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (!DRY_RUN) await writeCheckpoint(SCRIPT, processed, null, true);
  if (DRY_RUN) {
    const out = await writeDryRunReport(report);
    console.log(`\n[${SCRIPT}] dry-run ✓ counts=${JSON.stringify(report.counts)} → ${out}\n`);
  }
  console.log(`\n[${SCRIPT}] ${DRY_RUN ? "DRY-RUN" : "✓"} done — ${processed} processed, ${upserts} upserts, ${skipped} skipped\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
