import { NextResponse } from "next/server";
import { eq, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  shipments,
  shipmentItems,
  invoices,
} from "@/db/schema";
import { requirePermission, isResponse, assertSchoolAccess } from "@/lib/admin-guard";

/**
 * Recompute delivered_percent + billed_percent for an order
 * (audit §3.4 per_delivered + per_billed). Idempotent.
 *
 *   delivered_percent = sum(shipped+delivered shipment qty) / sum(order qty) * 100
 *   billed_percent    = invoice.grandTotal / order.total * 100
 */
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  // School scope: a school_admin may only act on their own school's orders.
  const denied = assertSchoolAccess(guard, order.schoolId);
  if (denied) return denied;

  // delivered % from shipment items where shipment is shipped or delivered
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id));
  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  let deliveredQty = 0;
  if (totalQty > 0) {
    const shipped = await db
      .select()
      .from(shipments)
      .where(eq(shipments.orderId, id));
    const shippedIds = shipped
      .filter((s) => s.statusEnum === "shipped" || s.statusEnum === "delivered")
      .map((s) => s.id);
    if (shippedIds.length > 0) {
      const sItems = await db
        .select()
        .from(shipmentItems)
        .where(inArray(shipmentItems.shipmentId, shippedIds));
      deliveredQty = sItems.reduce((s, i) => s + i.qty, 0);
    }
  }
  const deliveredPercent =
    totalQty === 0 ? 0 : Math.min(100, Math.round((deliveredQty / totalQty) * 100));

  // billed % from invoices
  const invs = await db
    .select()
    .from(invoices)
    .where(eq(invoices.orderId, id));
  const billedTotal = invs
    .filter((i) => !i.isReturn && i.status !== "cancelled")
    .reduce((s, i) => s + i.grandTotal, 0);
  const billedPercent =
    order.total === 0 ? 0 : Math.min(100, Math.round((billedTotal / order.total) * 100));

  await db
    .update(orders)
    .set({ deliveredPercent, billedPercent })
    .where(eq(orders.id, id));

  return NextResponse.json({ deliveredPercent, billedPercent });
}
