import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  parents,
  schools,
  shipments,
  invoices,
  payments,
  returns,
  erpOutboundQueue,
} from "@/db/schema";
import { requirePermission, isResponse, assertSchoolAccess } from "@/lib/admin-guard";
import { notifyOrderStatus } from "@/lib/notifications";
import {
  reserveOrder,
  releaseOrder,
  getDefaultWarehouseId,
} from "@/lib/repos/inventory";

const AddressShape = z.object({
  receiverName: z.string().min(1),
  receiverPhone: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(1),
});

/**
 * PATCH accepts the original status-change shape AND the new
 * inline-edit fields. Each field is independently optional so admins
 * can save just notes, just an address, or status alone without
 * round-tripping the whole order.
 */
const PatchBody = z.object({
  status: z
    .enum([
      "placed",
      "confirmed",
      "packed",
      "shipped",
      "delivered",
      "cancelled",
      "returned",
    ])
    .optional(),
  cancellationReason: z.string().optional(),
  notes: z.string().max(2000).nullable().optional(),
  shippingAddress: AddressShape.optional(),
  billingAddress: AddressShape.optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  displayStatus: z.string().max(60).nullable().optional(),
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("orders.read");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  const [order] = await db
    .select({
      order: orders,
      parent: parents,
      school: schools,
    })
    .from(orders)
    .innerJoin(parents, eq(parents.id, orders.parentId))
    .innerJoin(schools, eq(schools.id, orders.schoolId))
    .where(eq(orders.id, id))
    .limit(1);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  const denied = assertSchoolAccess(guard, order.order.schoolId);
  if (denied) return denied;

  const [items, shipmentRows, invoiceRows, paymentRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, id)),
    db.select().from(shipments).where(eq(shipments.orderId, id)),
    db.select().from(invoices).where(eq(invoices.orderId, id)),
    db.select().from(payments).where(eq(payments.orderId, id)),
  ]);

  return NextResponse.json({
    order: {
      ...order.order,
      parentName: order.parent.name,
      parentPhone: order.parent.phone,
      schoolName: order.school.name,
      items,
      shipments: shipmentRows,
      invoices: invoiceRows,
      payments: paymentRows,
    },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, PatchBody);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [before] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  const denied = assertSchoolAccess(guard, before.schoolId);
  if (denied) return denied;

  const update: Record<string, unknown> = {};
  const now = new Date();

  // Status + status-timestamp + cancellation reason — only when the
  // caller actually sent a `status` change. Inline-edit calls (notes,
  // address) leave it alone.
  if (body.status !== undefined) {
    update.status = body.status;
    if (body.status === "confirmed") update.confirmedAt = now;
    if (body.status === "packed") update.packedAt = now;
    if (body.status === "shipped") update.shippedAt = now;
    if (body.status === "delivered") update.deliveredAt = now;
    if (body.status === "cancelled") {
      update.cancellationReason = body.cancellationReason ?? "Admin cancelled";
    }
  }

  // Other editable fields — present-only update so a PATCH that omits
  // them doesn't clobber the existing values.
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.shippingAddress !== undefined) update.shippingAddress = body.shippingAddress;
  if (body.billingAddress !== undefined) update.billingAddress = body.billingAddress;
  if (body.tags !== undefined) update.tags = body.tags;
  if (body.displayStatus !== undefined) update.displayStatus = body.displayStatus;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  // Stock side effects — only relevant for status transitions.
  if (before.status !== "confirmed" && body.status === "confirmed") {
    // Just transitioned to confirmed → reserve. ERPNext-imported orders
    // can carry sub-items whose item_code has no local product variant
    // (variant_id = NULL); those don't track stock here, so we drop them
    // before calling reserveOrder which expects a concrete variantId.
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    const wh = await getDefaultWarehouseId();
    try {
      await reserveOrder(
        id,
        items
          .filter((i): i is typeof i & { variantId: string } => i.variantId !== null)
          .map((i) => ({ variantId: i.variantId, qty: i.qty })),
        wh,
        guard.id
      );
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "stock reservation failed" },
        { status: 409 }
      );
    }
  }

  if (
    body.status === "cancelled" &&
    (before.status === "confirmed" || before.status === "packed")
  ) {
    // Cancelling a reserved-but-not-shipped order → release the reservation.
    // Any later state ("shipped"/"delivered") has already drained the bins
    // via shipItems; cancelling those should go through a returns flow, not
    // this PATCH — guard against silent stock drift. Same NULL-variant
    // filter as reserveOrder above.
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    const wh = await getDefaultWarehouseId();
    await releaseOrder(
      id,
      items
        .filter((i): i is typeof i & { variantId: string } => i.variantId !== null)
        .map((i) => ({ variantId: i.variantId, qty: i.qty })),
      wh,
      guard.id
    );
  } else if (
    body.status === "cancelled" &&
    (before.status === "shipped" || before.status === "delivered")
  ) {
    return NextResponse.json(
      {
        error:
          "Cannot cancel a shipped/delivered order via PATCH; use the returns flow so stock and credit notes stay consistent.",
      },
      { status: 409 }
    );
  }

  await db.update(orders).set(update).where(eq(orders.id, id));

  // Status-transition side effects only fire when the PATCH actually
  // changed the status. Inline-edit calls (notes / address only) skip
  // notifications, ERP cancel queue, loyalty awards.
  if (body.status !== undefined && before.status !== body.status) {
    void notifyOrderStatus(id, body.status);
    const { emit } = await import("@/lib/event-bus");
    void emit(`order.${body.status}` as never, {
      orderId: id,
      orderNumber: before.orderNumber,
      previousStatus: before.status,
      status: body.status,
      total: before.total,
    });
    // Cancellations propagate to ERP through the buffered queue.
    if (body.status === "cancelled") {
      const { enqueueOrderEvent } = await import("@/lib/erp-bridge");
      void enqueueOrderEvent(id, "order.cancelled");
    }
    if (body.status === "delivered") {
      const { awardForOrder } = await import("@/lib/repos/loyalty");
      void awardForOrder({
        parentId: before.parentId,
        orderId: id,
        orderSubtotalPaise: before.subtotal,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * Hard-delete an order and all its dependent rows. Restricted to
 * `super` admin because the operation is irreversible and most FK
 * constraints don't cascade automatically — we have to clean them in
 * order inside a single transaction or we'll FK-violate.
 *
 * Per product decision (test-data cleanup use case): we do NOT cancel
 * the order in ERPNext. The Sales Order stays in ERPNext and just
 * stops being visible in our admin queue.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  const [before] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  if (!before) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Tell audit BEFORE the rows vanish — the buffered queue can't be used
  // here (the drain builds its envelope from the order row at send time,
  // which is about to be deleted), so this is the direct emit. Best-effort:
  // emitOrderEvent never throws, and the attempt lands in webhook_deliveries
  // so a failed notify can be replayed from /admin/erp-sync. Orders that
  // never reached audit (unpaid 'placed') send a delete the receiver simply
  // won't match — harmless, and cheaper than tracking which ones synced.
  // order.deleted (vs .cancelled) tells audit to remove the SO outright.
  {
    const { emitOrderEvent } = await import("@/lib/erp-bridge");
    await emitOrderEvent(id, "order.deleted");
  }

  // Run the cascade clean-up + parent delete in one transaction so a
  // mid-flight failure can't leave the order half-deleted.
  // Order matters: FK targets are deleted before the order itself.
  // Auto-cascades cover order_items + paymentSchedules + discountUsages
  // (SET NULL) + couponRedemptions (SET NULL).
  await db.transaction(async (tx) => {
    await tx.delete(erpOutboundQueue).where(eq(erpOutboundQueue.orderId, id));
    await tx.delete(returns).where(eq(returns.orderId, id));
    await tx.delete(invoices).where(eq(invoices.orderId, id));
    await tx.delete(shipments).where(eq(shipments.orderId, id));
    await tx.delete(payments).where(eq(payments.orderId, id));
    await tx.delete(orders).where(eq(orders.id, id));
  });

  return NextResponse.json({
    ok: true,
    deletedOrderNumber: before.orderNumber,
  });
}
