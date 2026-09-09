import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  purchaseReceipts,
  purchaseReceiptItems,
  purchaseOrders,
  purchaseOrderItems,
  suppliers,
  warehouses,
} from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";
import { applyStockChange } from "@/lib/repos/inventory";
import { nextNumber, financialYear, pad } from "@/lib/numbering";

export async function GET(req: Request) {
  const guard = await requirePermission("purchase-orders.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const poId = url.searchParams.get("poId");

  const conds = [];
  if (poId) conds.push(eq(purchaseReceipts.poId, poId));

  const rows = await db
    .select({
      receipt: purchaseReceipts,
      supplierName: suppliers.name,
      warehouseName: warehouses.name,
    })
    .from(purchaseReceipts)
    .innerJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseReceipts.warehouseId))
    .where(conds.length ? conds[0] : undefined)
    .orderBy(desc(purchaseReceipts.receivedAt))
    .limit(200);

  return NextResponse.json({ receipts: rows });
}

const Body = z.object({
  poId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  items: z
    .array(
      z.object({
        poItemId: z.string().uuid(),
        qty: z.number().int().min(1),
      })
    )
    .min(1),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("purchase-orders.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [po] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, body.poId))
    .limit(1);
  if (!po) return NextResponse.json({ error: "PO not found" }, { status: 404 });
  if (po.status === "cancelled" || po.status === "received") {
    return NextResponse.json(
      { error: `PO is ${po.status}` },
      { status: 400 }
    );
  }

  const poLines = await db
    .select()
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.poId, po.id));
  const poLineById = new Map(poLines.map((p) => [p.id, p]));

  for (const it of body.items) {
    const line = poLineById.get(it.poItemId);
    if (!line)
      return NextResponse.json(
        { error: `PO item ${it.poItemId} not on this PO` },
        { status: 400 }
      );
    const remaining = line.qty - line.receivedQty;
    if (it.qty > remaining)
      return NextResponse.json(
        { error: `Cannot receive ${it.qty} for "${line.description}"; only ${remaining} pending` },
        { status: 400 }
      );
  }

  // Allocate receipt number atomically
  const fy = financialYear();
  const seq = await nextNumber("PRC", fy);
  const receiptNumber = `PRC-${fy}-${pad(seq, 5)}`;

  const created = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(purchaseReceipts)
      .values({
        receiptNumber,
        poId: po.id,
        supplierId: po.supplierId,
        warehouseId: body.warehouseId,
        notes: body.notes ?? null,
        createdBy: guard.id,
      })
      .returning();

    await tx.insert(purchaseReceiptItems).values(
      body.items.map((it) => {
        const line = poLineById.get(it.poItemId)!;
        return {
          receiptId: r.id,
          poItemId: it.poItemId,
          variantId: line.variantId,
          description: line.description,
          qty: it.qty,
        };
      })
    );

    // Update receivedQty on each PO line
    for (const it of body.items) {
      await tx
        .update(purchaseOrderItems)
        .set({
          receivedQty: sql`${purchaseOrderItems.receivedQty} + ${it.qty}`,
        })
        .where(eq(purchaseOrderItems.id, it.poItemId));
    }

    // Bump PO header status
    const allLines = await tx
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, po.id));
    const fullyReceived = allLines.every(
      (l) =>
        l.receivedQty +
          (body.items.find((i) => i.poItemId === l.id)?.qty ?? 0) >=
        l.qty
    );
    // Note receivedQty was incremented above; re-read
    const reReadLines = await tx
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, po.id));
    const allDone = reReadLines.every((l) => l.receivedQty >= l.qty);
    await tx
      .update(purchaseOrders)
      .set({
        status: allDone ? "received" : "partially_received",
      })
      .where(eq(purchaseOrders.id, po.id));

    return r;
  });

  // Stock postings — outside the receipt tx because applyStockChange opens its own
  // (drizzle nests via savepoint; safe either way).
  for (const it of body.items) {
    const line = poLineById.get(it.poItemId);
    if (!line || !line.variantId) continue;
    await applyStockChange({
      variantId: line.variantId,
      warehouseId: body.warehouseId,
      delta: it.qty,
      reservedDelta: 0,
      reason: "receipt",
      refType: "purchase_receipt",
      refId: created.id,
      notes: `PO ${po.poNumber}`,
      createdBy: guard.id,
    });
  }

  void logAdminActivity(guard, {
    action: "purchase_receipt.create",
    entityType: "purchase_receipt",
    entityId: created.id,
    summary: `Received goods ${receiptNumber} against PO ${po.poNumber}`,
    req,
  });

  return NextResponse.json({ id: created.id, receiptNumber });
}
