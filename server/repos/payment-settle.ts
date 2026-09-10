import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, orderItems, payments } from "@/db/schema";
import { applyStockChange, getDefaultWarehouseId } from "@/server/repos/inventory";

/**
 * Settle a payment + confirm the order + decrement stock in a single
 * transaction. The CCAvenue callback is the sole caller today; we still
 * serialize with SELECT … FOR UPDATE on the payment row(s) so any future
 * retry path is safely idempotent. A second call sees status="paid" and
 * returns "already settled" without re-decrementing stock.
 *
 * Throws on stock shortfall — the caller decides whether to surface as a
 * 409 or log it and leave for ops.
 */
export type SettleResult =
  | { ok: true; alreadySettled: boolean }
  | { ok: false; reason: "order_not_found" | "no_payment_row" };

export async function settlePaymentAndDecrementStock(args: {
  orderId: string;
  paymentUpdate: Record<string, unknown>;
  createdBy?: string;
}): Promise<SettleResult> {
  const wh = await getDefaultWarehouseId();
  return db.transaction(async (tx) => {
    // Lock all payment rows for this order; concurrent settlers wait here.
    const lockedPays = await tx
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(eq(payments.orderId, args.orderId))
      .for("update");

    if (lockedPays.length === 0) {
      return { ok: false, reason: "no_payment_row" } as const;
    }
    if (lockedPays.some((r) => r.status === "paid")) {
      return { ok: true, alreadySettled: true } as const;
    }

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, args.orderId))
      .limit(1);
    if (!order) return { ok: false, reason: "order_not_found" } as const;

    await tx
      .update(payments)
      .set(args.paymentUpdate)
      .where(eq(payments.orderId, args.orderId));

    if (order.paymentStatus !== "paid") {
      await tx
        .update(orders)
        .set({
          paymentStatus: "paid",
          status: "confirmed",
          confirmedAt: new Date(),
        })
        .where(eq(orders.id, args.orderId));
    }

    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, args.orderId));

    for (const it of items) {
      // applyStockChange opens its own transaction; under drizzle/postgres-js
      // this becomes a savepoint within the outer tx — atomic rollback on
      // shortfall propagates up and aborts the settle.
      await applyStockChange({
        variantId: it.variantId,
        warehouseId: wh,
        delta: -it.qty,
        reason: "shipment_out",
        refType: "order",
        refId: args.orderId,
        createdBy: args.createdBy,
      });
    }

    return { ok: true, alreadySettled: false } as const;
  });
}
