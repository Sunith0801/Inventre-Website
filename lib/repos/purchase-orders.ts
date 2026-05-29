import "server-only";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  purchaseOrders,
  purchaseOrderItems,
  suppliers,
} from "@/db/schema";

export async function listPurchaseOrders(filter?: { status?: string }) {
  const conds = [];
  if (filter?.status)
    conds.push(eq(purchaseOrders.status, filter.status as never));
  return db
    .select({
      po: purchaseOrders,
      supplierName: suppliers.name,
      supplierCode: suppliers.supplierCode,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(conds.length ? conds[0] : undefined)
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(200);
}

export async function getPurchaseOrder(id: string) {
  const [po] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!po) return null;
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, po.supplierId))
    .limit(1);
  const items = await db
    .select()
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.poId, id));
  return { po, supplier, items };
}

export async function nextPoNumber(): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(purchaseOrders);
  const year = new Date().getFullYear();
  return `PO-${year}-${String(Number(count) + 1).padStart(5, "0")}`;
}

export type CreatePoInput = {
  supplierId: string;
  orderDate: string; // YYYY-MM-DD
  expectedDate?: string | null;
  items: {
    variantId?: string | null;
    description: string;
    qty: number;
    unitPrice: number; // paise
  }[];
  notes?: string | null;
  createdBy?: string;
};

export async function createPurchaseOrder(input: CreatePoInput) {
  const poNumber = await nextPoNumber();
  const subtotal = input.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const grandTotal = subtotal; // taxes added later if needed

  return db.transaction(async (tx) => {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        poNumber,
        supplierId: input.supplierId,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate ?? null,
        subtotal,
        taxTotal: 0,
        grandTotal,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    for (const it of input.items) {
      await tx.insert(purchaseOrderItems).values({
        poId: po.id,
        variantId: it.variantId ?? null,
        description: it.description,
        qty: it.qty,
        unitPrice: it.unitPrice,
        total: it.qty * it.unitPrice,
      });
    }
    return po;
  });
}
