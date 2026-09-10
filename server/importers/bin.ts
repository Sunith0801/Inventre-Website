import "server-only";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { bins, productVariants, warehouses } from "@/db/schema";
import type { DocTypeImporter, ImportRow } from "@/server/importers/_types";
import { pickField, pickInt } from "@/server/importers/_types";
import { applyStockChange } from "@/server/repos/inventory";

export const binImporter: DocTypeImporter = {
  doctype: "Bin",
  filenameHints: ["bin", "bins", "stock"],
  signatureHeaders: ["item_code", "warehouse", "actual_qty"],

  async processOne(row: ImportRow) {
    const itemCode = pickField(row, "item_code", "Item Code", "sku");
    const warehouseName = pickField(row, "warehouse", "Warehouse") ?? "Stores - IESPL";
    const targetActual = pickInt(row, "actual_qty", "Actual Qty");
    const targetReserved = pickInt(row, "reserved_qty", "Reserved Qty") ?? 0;
    const valuationP = (() => {
      const v = pickInt(row, "valuation_rate", "Valuation Rate");
      return v == null ? null : v * 100;
    })();

    if (!itemCode) return { result: "skipped", error: "missing item_code" };
    if (targetActual == null) return { result: "skipped", error: "missing actual_qty" };

    const variantRow = await db.select().from(productVariants).where(eq(productVariants.sku, itemCode)).limit(1);
    if (!variantRow[0]) return { result: "skipped", error: `variant ${itemCode} not found` };

    let whRow = await db.select().from(warehouses).where(eq(warehouses.name, warehouseName)).limit(1);
    if (!whRow[0]) {
      const code = warehouseName.replace(/\s+/g, "_").toUpperCase();
      const [created] = await db.insert(warehouses).values({ name: warehouseName, code }).returning();
      whRow = [created];
    }

    const variantId = variantRow[0].id;
    const warehouseId = whRow[0].id;

    // Compute delta against current bin state, then route through applyStockChange
    // so the ledger gets a row with FOR UPDATE semantics. Valuation is a
    // direct field set after the change.
    const existing = await db
      .select()
      .from(bins)
      .where(and(eq(bins.variantId, variantId), eq(bins.warehouseId, warehouseId)))
      .limit(1);

    const currentActual = existing[0]?.actualQty ?? 0;
    const currentReserved = existing[0]?.reservedQty ?? 0;
    const delta = targetActual - currentActual;
    const reservedDelta = targetReserved - currentReserved;

    if (delta !== 0 || reservedDelta !== 0 || !existing[0]) {
      await applyStockChange(
        {
          variantId,
          warehouseId,
          delta,
          reservedDelta,
          reason: existing[0] ? "adjustment" : "receipt",
          refType: "csv_import",
          notes: existing[0]
            ? `CSV reconcile: actual ${currentActual}→${targetActual}, reserved ${currentReserved}→${targetReserved}`
            : "Initial stock from CSV upload",
        },
        { allowNegative: true }
      );
    }

    if (valuationP != null) {
      await db
        .update(bins)
        .set({ valuationRate: valuationP, updatedAt: new Date() })
        .where(and(eq(bins.variantId, variantId), eq(bins.warehouseId, warehouseId)));
    }

    return { result: existing[0] ? "updated" : "new" };
  },
};
