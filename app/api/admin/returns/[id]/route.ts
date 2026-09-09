import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  returns,
  returnItems,
  invoices,
  orders,
  orderItems,
} from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { returnToStock, getDefaultWarehouseId } from "@/lib/repos/inventory";
import { generateCreditNote } from "@/lib/repos/invoices";
import { allocOrderNumber } from "@/lib/numbering";
import { logAdminActivity } from "@/lib/activity";

const Body = z.object({
  action: z.enum(["approve", "reject", "receive", "refund", "create_replacement"]),
  refundAmount: z.number().int().min(0).optional(),
  refundMethod: z.enum(["original", "wallet", "bank"]).optional(),
  notes: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("returns.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [ret] = await db
    .select()
    .from(returns)
    .where(eq(returns.id, id))
    .limit(1);
  if (!ret) return NextResponse.json({ error: "not found" }, { status: 404 });

  const items = await db
    .select()
    .from(returnItems)
    .where(eq(returnItems.returnId, id));

  if (body.action === "approve") {
    await db
      .update(returns)
      .set({
        status: "approved",
        approvedBy: guard.id,
        approvedAt: new Date(),
        notes: body.notes ?? ret.notes,
        updatedAt: new Date(),
      })
      .where(eq(returns.id, id));
    void logAdminActivity(guard, {
      action: "return.status",
      entityType: "return",
      entityId: id,
      summary: `Status: ${ret.status} → approved`,
      remarks: body.notes ?? null,
      req,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reject") {
    await db
      .update(returns)
      .set({
        status: "rejected",
        approvedBy: guard.id,
        approvedAt: new Date(),
        notes: body.notes ?? ret.notes,
        updatedAt: new Date(),
      })
      .where(eq(returns.id, id));
    void logAdminActivity(guard, {
      action: "return.status",
      entityType: "return",
      entityId: id,
      summary: `Status: ${ret.status} → rejected`,
      remarks: body.notes ?? null,
      req,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "receive") {
    // Items in unopened condition go back into stock; opened/damaged stay out.
    const stockable = items.filter((i) => i.condition === "unopened");
    if (stockable.length > 0) {
      const wh = await getDefaultWarehouseId();
      await returnToStock(
        id,
        stockable.map((i) => ({
          variantId: i.variantId,
          qty: i.qty,
          warehouseId: wh,
        })),
        guard.id
      );
    }
    await db
      .update(returns)
      .set({
        status: "received",
        receivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(returns.id, id));
    void logAdminActivity(guard, {
      action: "return.status",
      entityType: "return",
      entityId: id,
      summary: `Status: ${ret.status} → received (${stockable.length} restocked, ${items.length - stockable.length} held)`,
      req,
    });
    return NextResponse.json({
      ok: true,
      restocked: stockable.length,
      held: items.length - stockable.length,
    });
  }

  if (body.action === "refund") {
    // Find the parent invoice for this order to issue a credit note
    const [parentInvoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.orderId, ret.orderId))
      .limit(1);

    let creditNoteId: string | null = null;
    let creditNoteNumber: string | null = null;

    if (parentInvoice) {
      // Map return items → invoice items (best-effort by orderItemId match)
      // For simplicity we issue full-qty credit per returned item.
      const returnedSummary = items.map((i) => ({
        invoiceItemId: i.orderItemId, // proxy: invoice items reference orderItemId
        qty: i.qty,
      }));
      try {
        const cn = await generateCreditNote({
          parentInvoiceId: parentInvoice.id,
          returnedItems: returnedSummary,
        });
        creditNoteId = cn.id;
        creditNoteNumber = cn.invoiceNumber;
      } catch (e) {
        // continue without credit note
      }
    }

    await db
      .update(returns)
      .set({
        status: "refunded",
        refundedAt: new Date(),
        refundAmount: body.refundAmount ?? ret.refundAmount ?? 0,
        refundMethod: body.refundMethod ?? "original",
        creditNoteInvoiceId: creditNoteId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(returns.id, id));

    void logAdminActivity(guard, {
      action: "return.status",
      entityType: "return",
      entityId: id,
      summary: `Status: ${ret.status} → refunded${creditNoteNumber ? ` (credit note ${creditNoteNumber})` : ""}`,
      req,
    });
    return NextResponse.json({
      ok: true,
      creditNoteId,
      creditNoteNumber,
    });
  }

  if (body.action === "create_replacement") {
    // Spawn a new order with isReplacement=true linked to the original SO.
    const [original] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, ret.orderId))
      .limit(1);
    if (!original)
      return NextResponse.json({ error: "Original order missing" }, { status: 400 });

    // Match return-item qty back to original order-item snapshots.
    const origItems = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, original.id));
    const origByOrderItemId = new Map(origItems.map((o) => [o.id, o]));

    const replacementLines = items
      .map((ri) => {
        const o = origByOrderItemId.get(ri.orderItemId);
        if (!o) return null;
        return {
          variantId: ri.variantId,
          nameSnapshot: o.nameSnapshot,
          imageSnapshot: o.imageSnapshot ?? null,
          size: o.size,
          qty: ri.qty,
          unitPrice: o.unitPrice,
          total: o.unitPrice * ri.qty,
          hsnCodeSnapshot: o.hsnCodeSnapshot ?? null,
          gstTreatmentSnapshot: o.gstTreatmentSnapshot ?? null,
          gstInclusiveSnapshot: o.gstInclusiveSnapshot ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (replacementLines.length === 0) {
      return NextResponse.json(
        { error: "No matching items for replacement" },
        { status: 400 }
      );
    }

    const subtotal = replacementLines.reduce((s, l) => s + l.total, 0);
    const replacementNumber = await allocOrderNumber();
    const now = new Date();

    const created = await db.transaction(async (tx) => {
      const [draft] = await tx
        .insert(orders)
        .values({
          orderNumber: replacementNumber,
          parentId: original.parentId,
          studentId: original.studentId,
          schoolId: original.schoolId,
          status: "confirmed", // replacement is approved up-front
          paymentStatus: "paid", // already paid for in the original order
          subtotal,
          tax: 0,
          shipping: 0,
          discount: 0,
          total: subtotal,
          shippingAddress: original.shippingAddress,
          notes: `Replacement for ${original.orderNumber} (return ${ret.returnNumber})`,
          placedAt: now,
          confirmedAt: now,
          schoolNameSnapshot: original.schoolNameSnapshot,
          warehouseId: original.warehouseId,
          financialYear: original.financialYear,
          placeOfSupply: original.placeOfSupply,
          gstCategory: original.gstCategory,
          isReplacement: true,
          replacementForOrderId: original.id,
        })
        .returning();
      await tx
        .insert(orderItems)
        .values(replacementLines.map((l) => ({ orderId: draft.id, ...l })));
      return draft;
    });

    void logAdminActivity(guard, {
      action: "return.replacement",
      entityType: "return",
      entityId: id,
      summary: `Created replacement order ${replacementNumber} for ${original.orderNumber}`,
      req,
    });
    return NextResponse.json({
      ok: true,
      orderId: created.id,
      orderNumber: replacementNumber,
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
