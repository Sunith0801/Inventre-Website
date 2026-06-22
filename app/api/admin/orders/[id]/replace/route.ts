import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, orderItems } from "@/db/schema";
import { requirePermission, isResponse, assertSchoolAccess } from "@/lib/admin-guard";
import { generateOrderNumber } from "@/lib/repos/orders";
import { financialYearOf } from "@/lib/invoice-numbering";

/**
 * Create a replacement Sales Order from an existing one (audit §3.4
 * custom_is_replacement_so). Used when a return is approved and the customer
 * wants the same items shipped fresh instead of a refund.
 *
 * Body: { items: [{ orderItemId, qty }] }  — subset of the original
 * Defaults to all items + qty if no items provided.
 */
const Body = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        qty: z.number().int().min(1),
      })
    )
    .optional(),
  reason: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;
  const { id: originalOrderId } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [original] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, originalOrderId))
    .limit(1);
  if (!original) return NextResponse.json({ error: "not found" }, { status: 404 });
  // School scope: a school_admin may only replace their own school's orders.
  const denied = assertSchoolAccess(guard, original.schoolId);
  if (denied) return denied;

  const originalItems = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, originalOrderId));

  const itemsToReplace = body.items
    ? body.items.map((it) => {
        const orig = originalItems.find((o) => o.id === it.orderItemId);
        if (!orig) throw new Error(`unknown orderItem ${it.orderItemId}`);
        return { orig, qty: it.qty };
      })
    : originalItems.map((o) => ({ orig: o, qty: o.qty }));

  if (itemsToReplace.length === 0) {
    return NextResponse.json({ error: "no items to replace" }, { status: 400 });
  }

  const subtotal = itemsToReplace.reduce(
    (s, it) => s + it.orig.unitPrice * it.qty,
    0
  );
  const total = subtotal + (original.tax ?? 0) + (original.shipping ?? 0);

  const orderNumber = await generateOrderNumber();
  const [replacement] = await db
    .insert(orders)
    .values({
      orderNumber,
      parentId: original.parentId,
      studentId: original.studentId,
      schoolId: original.schoolId,
      status: "confirmed",
      paymentStatus: "paid", // replacement is paid via the original order
      subtotal,
      tax: 0,
      shipping: 0,
      discount: 0,
      total,
      shippingAddress: original.shippingAddress,
      billingAddress: original.billingAddress,
      notes: body.reason ?? `Replacement for ${original.orderNumber}`,
      placedAt: new Date(),
      confirmedAt: new Date(),
      schoolNameSnapshot: original.schoolNameSnapshot,
      warehouseId: original.warehouseId,
      financialYear: financialYearOf(),
      placeOfSupply: original.placeOfSupply,
      gstCategory: original.gstCategory,
      isReplacement: true,
      replacementForOrderId: originalOrderId,
    })
    .returning();

  await db.insert(orderItems).values(
    itemsToReplace.map((it) => ({
      orderId: replacement.id,
      variantId: it.orig.variantId,
      nameSnapshot: it.orig.nameSnapshot,
      imageSnapshot: it.orig.imageSnapshot,
      size: it.orig.size,
      qty: it.qty,
      unitPrice: it.orig.unitPrice,
      total: it.orig.unitPrice * it.qty,
      hsnCodeSnapshot: it.orig.hsnCodeSnapshot,
      gstTreatmentSnapshot: it.orig.gstTreatmentSnapshot,
    }))
  );

  return NextResponse.json({
    id: replacement.id,
    orderNumber,
    isReplacement: true,
    replacementForOrderId: originalOrderId,
  });
}
