import "server-only";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bins,
  warehouses,
  stockLedger,
  productVariants,
  products,
} from "@/db/schema";
import { invalidate } from "@/server/cache";

/**
 * Inventory engine — single point of truth for stock writes.
 *
 * Stock model (Phase 3):
 *   - actualQty:   physical units in the warehouse
 *   - reservedQty: units allocated to confirmed orders, not yet shipped
 *   - available  = actualQty - reservedQty   (what we can still sell)
 *
 * Every mutation goes through `applyStockChange()` which:
 *   1. Locks the bin row (FOR UPDATE)
 *   2. Updates actualQty / reservedQty
 *   3. Appends a stock_ledger row
 *
 * Concurrency is handled at the row level via Postgres pessimistic locks,
 * not at the application level. Multiple parents can confirm orders
 * simultaneously without races.
 */

export type StockChange = {
  variantId: string;
  warehouseId: string;
  delta: number; // +receipt / −issue (change to actualQty)
  reservedDelta?: number; // +reserve / −release (change to reservedQty)
  reason:
    | "order_reserve"
    | "order_release"
    | "shipment_out"
    | "receipt"
    | "adjustment"
    | "return_in";
  refType?: string;
  refId?: string;
  notes?: string;
  createdBy?: string;
};

export type BinView = {
  variantId: string;
  warehouseId: string;
  warehouseName: string;
  actualQty: number;
  reservedQty: number;
  available: number;
  minStockLevel: number;
};

/** Default warehouse id — cached after first lookup. */
let _defaultWarehouseId: string | null = null;
export async function getDefaultWarehouseId(): Promise<string> {
  if (_defaultWarehouseId) return _defaultWarehouseId;
  const [row] = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.isDefault, true))
    .limit(1);
  if (!row) {
    throw new Error("No default warehouse configured. Run db:seed.");
  }
  _defaultWarehouseId = row.id;
  return row.id;
}

/**
 * Apply a stock change atomically. Use within an outer transaction when chaining.
 *
 * Locks the bin row, updates qty, appends ledger row, returns the new state.
 * Throws if reservation would exceed actual stock and `allowNegative` is false.
 */
export async function applyStockChange(
  change: StockChange,
  options: { allowNegative?: boolean } = {}
): Promise<BinView> {
  const { variantId, warehouseId } = change;
  const allowNegative = options.allowNegative ?? false;

  return await db.transaction(async (tx) => {
    // Lock bin row, or create if missing.
    const [existing] = await tx
      .select()
      .from(bins)
      .where(and(eq(bins.variantId, variantId), eq(bins.warehouseId, warehouseId)))
      .for("update")
      .limit(1);

    let actualQty = (existing?.actualQty ?? 0) + change.delta;
    let reservedQty = (existing?.reservedQty ?? 0) + (change.reservedDelta ?? 0);

    if (!allowNegative) {
      if (actualQty < 0) {
        throw new Error(
          `stock would go negative: variant ${variantId} actualQty=${actualQty}`
        );
      }
      if (reservedQty < 0) {
        // Releasing more than reserved is always a bug; clamp to zero defensively.
        reservedQty = 0;
      }
      if (reservedQty > actualQty + Math.abs(change.delta)) {
        // For an order reservation, ensure we don't reserve more than actual.
        if (change.reason === "order_reserve" && reservedQty > actualQty) {
          throw new Error(
            `cannot reserve ${change.reservedDelta} for variant ${variantId}: only ${
              actualQty - (existing?.reservedQty ?? 0)
            } available`
          );
        }
      }
    }

    if (existing) {
      await tx
        .update(bins)
        .set({
          actualQty,
          reservedQty,
          updatedAt: new Date(),
        })
        .where(eq(bins.id, existing.id));
    } else if (actualQty !== 0 || reservedQty !== 0) {
      // Only mint a bin row when the change actually establishes stock.
      // A no-op result (0 actual / 0 reserved) on a variant that never had a
      // bin must NOT create one: cancelling an order containing a made-to-order
      // item runs order_release (reservedDelta -qty) on a never-reserved
      // variant, which clamps to 0/0 and previously inserted a phantom 0/0 bin.
      // That phantom flips variant-resolver's "untracked = available" default
      // (99999) into available=0, hard-blocking every future buyer at checkout.
      // Skipping the insert keeps the variant untracked/available. The ledger
      // row below still records the event for audit.
      await tx.insert(bins).values({
        variantId,
        warehouseId,
        actualQty,
        reservedQty,
      });
    }

    await tx.insert(stockLedger).values({
      variantId,
      warehouseId,
      delta: change.delta,
      newActualQty: actualQty,
      reservedDelta: change.reservedDelta ?? 0,
      newReservedQty: reservedQty,
      reason: change.reason,
      refType: change.refType ?? null,
      refId: change.refId ?? null,
      createdBy: change.createdBy ?? null,
      notes: change.notes ?? null,
    });

    // Invalidate any cached availability for this variant.
    void invalidate(`stock:${variantId}`);

    const [wh] = await tx
      .select({ name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId))
      .limit(1);

    return {
      variantId,
      warehouseId,
      warehouseName: wh?.name ?? "?",
      actualQty,
      reservedQty,
      available: actualQty - reservedQty,
      minStockLevel: existing?.minStockLevel ?? 0,
    };
  });
}

/**
 * Reserve stock for an order. Called when payment succeeds and order moves
 * to "confirmed". Reserves across all order items in one transaction.
 */
export async function reserveOrder(
  orderId: string,
  lines: { variantId: string; qty: number }[],
  warehouseId?: string,
  createdBy?: string
): Promise<void> {
  const wh = warehouseId ?? (await getDefaultWarehouseId());
  for (const line of lines) {
    await applyStockChange({
      variantId: line.variantId,
      warehouseId: wh,
      delta: 0,
      reservedDelta: line.qty,
      reason: "order_reserve",
      refType: "order",
      refId: orderId,
      createdBy,
    });
  }
}

/** Release reservation when an order is cancelled before shipment. */
export async function releaseOrder(
  orderId: string,
  lines: { variantId: string; qty: number }[],
  warehouseId?: string,
  createdBy?: string
): Promise<void> {
  const wh = warehouseId ?? (await getDefaultWarehouseId());
  for (const line of lines) {
    await applyStockChange({
      variantId: line.variantId,
      warehouseId: wh,
      delta: 0,
      reservedDelta: -line.qty,
      reason: "order_release",
      refType: "order",
      refId: orderId,
      createdBy,
    });
  }
}

/**
 * Ship: move from reserved → out (decrement actual & reserved by qty).
 * Used per shipment item.
 */
export async function shipItems(
  shipmentId: string,
  lines: { variantId: string; qty: number; warehouseId: string }[],
  createdBy?: string
): Promise<void> {
  for (const line of lines) {
    await applyStockChange({
      variantId: line.variantId,
      warehouseId: line.warehouseId,
      delta: -line.qty,
      reservedDelta: -line.qty,
      reason: "shipment_out",
      refType: "shipment",
      refId: shipmentId,
      createdBy,
    });
  }
}

/** Stock returned in good condition → back to actualQty. */
export async function returnToStock(
  returnId: string,
  lines: { variantId: string; qty: number; warehouseId: string }[],
  createdBy?: string
): Promise<void> {
  for (const line of lines) {
    await applyStockChange({
      variantId: line.variantId,
      warehouseId: line.warehouseId,
      delta: line.qty,
      reservedDelta: 0,
      reason: "return_in",
      refType: "return",
      refId: returnId,
      createdBy,
    });
  }
}

export async function adjust(
  variantId: string,
  warehouseId: string,
  delta: number,
  notes: string,
  createdBy?: string
): Promise<BinView> {
  return applyStockChange({
    variantId,
    warehouseId,
    delta,
    reservedDelta: 0,
    reason: "adjustment",
    refType: "adjustment",
    notes,
    createdBy,
  });
}

/** Read current stock for a variant. */
export async function getBinForVariant(
  variantId: string,
  warehouseId?: string
): Promise<BinView | null> {
  const wh = warehouseId ?? (await getDefaultWarehouseId());
  const [row] = await db
    .select({
      bin: bins,
      warehouseName: warehouses.name,
    })
    .from(bins)
    .innerJoin(warehouses, eq(warehouses.id, bins.warehouseId))
    .where(and(eq(bins.variantId, variantId), eq(bins.warehouseId, wh)))
    .limit(1);
  if (!row) return null;
  return {
    variantId,
    warehouseId: wh,
    warehouseName: row.warehouseName,
    actualQty: row.bin.actualQty,
    reservedQty: row.bin.reservedQty,
    available: row.bin.actualQty - row.bin.reservedQty,
    minStockLevel: row.bin.minStockLevel,
  };
}

/** Check if `qty` units are available; returns the available count. */
export async function getAvailableQty(
  variantId: string,
  warehouseId?: string
): Promise<number> {
  const view = await getBinForVariant(variantId, warehouseId);
  if (!view) return 0;
  return Math.max(0, view.available);
}

/** Low-stock report: variants where available <= minStockLevel. */
export type LowStockRow = {
  variantId: string;
  productName: string;
  size: string;
  sku: string;
  warehouseName: string;
  actualQty: number;
  reservedQty: number;
  available: number;
  minStockLevel: number;
};

export async function listLowStock(warehouseId?: string): Promise<LowStockRow[]> {
  const wh = warehouseId ?? (await getDefaultWarehouseId());
  const rows = await db
    .select({
      variantId: bins.variantId,
      actualQty: bins.actualQty,
      reservedQty: bins.reservedQty,
      minStockLevel: bins.minStockLevel,
      warehouseName: warehouses.name,
      productName: products.name,
      size: productVariants.size,
      sku: productVariants.sku,
    })
    .from(bins)
    .innerJoin(warehouses, eq(warehouses.id, bins.warehouseId))
    .innerJoin(productVariants, eq(productVariants.id, bins.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(bins.warehouseId, wh),
        eq(productVariants.isActive, true),
        sql`${bins.actualQty} - ${bins.reservedQty} <= ${bins.minStockLevel}`
      )
    )
    .orderBy(sql`${bins.actualQty} - ${bins.reservedQty} ASC`);

  return rows.map((r) => ({
    variantId: r.variantId,
    productName: r.productName,
    size: r.size,
    sku: r.sku,
    warehouseName: r.warehouseName,
    actualQty: r.actualQty,
    reservedQty: r.reservedQty,
    available: r.actualQty - r.reservedQty,
    minStockLevel: r.minStockLevel,
  }));
}

/** Stock ledger for a single variant — audit trail UI. */
export async function getLedger(variantId: string, warehouseId?: string, limit = 100) {
  const wh = warehouseId ?? (await getDefaultWarehouseId());
  return db
    .select()
    .from(stockLedger)
    .where(
      and(
        eq(stockLedger.variantId, variantId),
        eq(stockLedger.warehouseId, wh)
      )
    )
    .orderBy(desc(stockLedger.createdAt))
    .limit(limit);
}
