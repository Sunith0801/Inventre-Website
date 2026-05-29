/* eslint-disable no-console */
/**
 * Migrate Bin (stock) records into our `bins` + initial `stockLedger` snapshot.
 *
 *   npx tsx scripts/migrate-from-erp/07-stock.ts [--sample=N]
 */

import { erpListPages } from "./_client";
import { db, shutdown, ensureCheckpointTable, writeCheckpoint, logMigrationError } from "./_db";
import { bins, productVariants, warehouses, stockLedger } from "../../db/schema";
import { eq, and } from "drizzle-orm";

const SCRIPT = "07-stock";

type Bin = {
  name: string;
  item_code: string;
  warehouse: string;
  actual_qty: number;
  reserved_qty: number;
  projected_qty?: number;
  valuation_rate?: number;
};

async function main() {
  const sample = Number(process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 0);
  await ensureCheckpointTable();
  console.log(`\n[${SCRIPT}] migrating Bin records${sample ? ` (sample ${sample})` : ""}\n`);

  // Upsert "Stores - IESPL" warehouse if not already
  let [wh] = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.name, "Stores - IESPL"))
    .limit(1);
  if (!wh) {
    [wh] = await db
      .insert(warehouses)
      .values({ name: "Stores - IESPL", code: "STORES_IESPL", isDefault: true })
      .returning();
  }

  let processed = 0, upserts = 0, skipped = 0;

  for await (const page of erpListPages<Bin>("Bin", {
    fields: ["name", "item_code", "warehouse", "actual_qty", "reserved_qty", "valuation_rate"],
    filters: [["warehouse", "=", "Stores - IESPL"]],
    pageSize: 200,
    sample: sample || undefined,
  })) {
    for (const b of page) {
      try {
        const variantRow = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.sku, b.item_code))
          .limit(1);
        if (!variantRow[0]) {
          await logMigrationError(SCRIPT, "Bin", b.name, `variant ${b.item_code} not found`);
          skipped++;
          continue;
        }

        const valuationP = b.valuation_rate ? Math.round(b.valuation_rate * 100) : null;

        const existing = await db
          .select()
          .from(bins)
          .where(and(eq(bins.variantId, variantRow[0].id), eq(bins.warehouseId, wh.id)))
          .limit(1);
        if (existing[0]) {
          await db
            .update(bins)
            .set({
              actualQty: b.actual_qty,
              reservedQty: b.reserved_qty,
              valuationRate: valuationP,
              updatedAt: new Date(),
            })
            .where(eq(bins.id, existing[0].id));
        } else {
          await db.insert(bins).values({
            variantId: variantRow[0].id,
            warehouseId: wh.id,
            actualQty: b.actual_qty,
            reservedQty: b.reserved_qty,
            valuationRate: valuationP,
          });
          // initial ledger entry
          await db.insert(stockLedger).values({
            variantId: variantRow[0].id,
            warehouseId: wh.id,
            delta: b.actual_qty,
            newActualQty: b.actual_qty,
            reservedDelta: b.reserved_qty,
            newReservedQty: b.reserved_qty,
            reason: "receipt",
            refType: "erp_migration",
            notes: "Initial stock from ERP migration",
          });
        }

        upserts++;
        processed++;
        if (processed % 100 === 0) {
          console.log(`  progress: ${processed} bins (${upserts} upserts, ${skipped} skipped)`);
          await writeCheckpoint(SCRIPT, processed, b.name);
        }
      } catch (e) {
        await logMigrationError(SCRIPT, "Bin", b.name, e instanceof Error ? e.message : String(e));
      }
    }
  }

  await writeCheckpoint(SCRIPT, processed, null, true);
  console.log(`\n[${SCRIPT}] ✓ done — ${processed} processed, ${upserts} upserts, ${skipped} skipped\n`);
  await shutdown();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await shutdown();
  process.exit(1);
});
