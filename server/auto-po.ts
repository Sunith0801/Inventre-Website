import "server-only";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bins,
  productVariants,
  products,
  warehouses,
  suppliers,
  purchaseOrders,
  purchaseOrderItems,
  systemSettings,
} from "@/db/schema";
import { allocPoNumber } from "@/server/numbering";

/**
 * Auto-PO scheduler.
 *
 * For each variant with available <= reorder level (bins.minStockLevel), pick
 * the most-recent supplier from PO history (or fall back to the default
 * supplier in system_settings.auto_po.default_supplier). Group lines by
 * supplier and emit one Draft PO per supplier.
 *
 * Idempotency: skips variants that already appear on an open Draft / Submitted
 * PO so re-runs don't duplicate orders.
 */

export type AutoPoResult = {
  posCreated: number;
  variantsOrdered: number;
  skipped: { reason: string; count: number }[];
};

export async function runAutoPo(opts: {
  defaultSupplierId?: string;
  reorderQty?: number; // suggested order qty when no history
} = {}): Promise<AutoPoResult> {
  // Default supplier from system settings
  let defaultSupplierId = opts.defaultSupplierId;
  if (!defaultSupplierId) {
    const [s] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, "auto_po.default_supplier"))
      .limit(1);
    const v = s?.value;
    defaultSupplierId = typeof v === "string" ? v : undefined;
  }

  // Find variants under reorder level
  const lowRows = await db
    .select({
      variantId: bins.variantId,
      warehouseId: bins.warehouseId,
      actualQty: bins.actualQty,
      reservedQty: bins.reservedQty,
      minStockLevel: bins.minStockLevel,
      productName: products.name,
      sku: productVariants.sku,
      basePrice: products.basePrice,
    })
    .from(bins)
    .innerJoin(productVariants, eq(productVariants.id, bins.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(warehouses, eq(warehouses.id, bins.warehouseId))
    .where(
      sql`${bins.actualQty} - ${bins.reservedQty} <= ${bins.minStockLevel}
        AND ${bins.minStockLevel} > 0
        AND ${productVariants.isActive} = true`
    );

  if (lowRows.length === 0) {
    return { posCreated: 0, variantsOrdered: 0, skipped: [] };
  }

  // Variants already on an open PO — exclude
  const onOpenPo = await db
    .select({ variantId: purchaseOrderItems.variantId })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.poId))
    .where(
      sql`${purchaseOrders.status} IN ('draft', 'submitted', 'partially_received')`
    );
  const onOpenPoSet = new Set(onOpenPo.map((r) => r.variantId).filter(Boolean));

  const skipped: { reason: string; count: number }[] = [];
  let alreadyOpenCount = 0;
  let noSupplierCount = 0;

  // Resolve preferred supplier per variant from most-recent PO line
  const candidates: {
    variantId: string;
    warehouseId: string;
    qty: number;
    productName: string;
    sku: string;
    unitPrice: number;
    supplierId: string;
  }[] = [];

  for (const row of lowRows) {
    if (onOpenPoSet.has(row.variantId)) {
      alreadyOpenCount++;
      continue;
    }
    // Find most-recent supplier
    const [recent] = await db
      .select({
        supplierId: purchaseOrders.supplierId,
        unitPrice: purchaseOrderItems.unitPrice,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.poId))
      .where(eq(purchaseOrderItems.variantId, row.variantId))
      .orderBy(desc(purchaseOrders.orderDate))
      .limit(1);

    const supplierId = recent?.supplierId ?? defaultSupplierId;
    if (!supplierId) {
      noSupplierCount++;
      continue;
    }
    const unitPrice = recent?.unitPrice ?? row.basePrice ?? 0;
    const reorderQty =
      opts.reorderQty ??
      Math.max(
        row.minStockLevel * 2,
        row.minStockLevel - (row.actualQty - row.reservedQty) + row.minStockLevel
      );

    candidates.push({
      variantId: row.variantId,
      warehouseId: row.warehouseId,
      qty: reorderQty,
      productName: row.productName,
      sku: row.sku,
      unitPrice,
      supplierId,
    });
  }

  if (alreadyOpenCount) {
    skipped.push({ reason: "already on open PO", count: alreadyOpenCount });
  }
  if (noSupplierCount) {
    skipped.push({
      reason: "no supplier history and no default",
      count: noSupplierCount,
    });
  }

  // Group by supplier
  const bySupplier = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const arr = bySupplier.get(c.supplierId) ?? [];
    arr.push(c);
    bySupplier.set(c.supplierId, arr);
  }

  let posCreated = 0;
  let variantsOrdered = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const [supplierId, lines] of bySupplier.entries()) {
    const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const poNumber = await allocPoNumber();
    await db.transaction(async (tx) => {
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          poNumber,
          supplierId,
          status: "draft",
          orderDate: today,
          subtotal,
          taxTotal: 0,
          grandTotal: subtotal,
          notes: "Auto-generated by reorder scheduler",
        })
        .returning();
      await tx.insert(purchaseOrderItems).values(
        lines.map((l) => ({
          poId: po.id,
          variantId: l.variantId,
          description: `${l.productName} (${l.sku})`,
          qty: l.qty,
          unitPrice: l.unitPrice,
          total: l.unitPrice * l.qty,
        }))
      );
    });
    posCreated++;
    variantsOrdered += lines.length;
  }

  return { posCreated, variantsOrdered, skipped };
}
