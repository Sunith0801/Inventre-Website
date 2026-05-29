/**
 * Shared finaliser for CCAvenue order state transitions.
 *
 * Both the inline callback route (browser redirect / webhook) and the
 * Status-API poller (parent-side polling endpoint + cron reconciler) flip
 * a payment from pending → paid / failed. The side effects on "paid"
 * (decrement stock, clear cart, SMS the parent, enqueue the ERP push)
 * MUST be identical regardless of which path got there, otherwise we'd
 * end up with paid orders that never decremented stock just because the
 * reconciler beat the browser to it.
 *
 * Everything below is idempotent — re-firing for an already-finalised
 * order is a no-op and reports `kind: "no-change"` so callers can log.
 *
 * Not `server-only`: also imported by tsx admin tools that run outside
 * the Next.js runtime, same convention as lib/repos/product-attribute-groups.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  payments,
  orderItems,
  students,
  websiteCartCouponUsages,
} from "@/db/schema";
import {
  applyStockChange,
  getDefaultWarehouseId,
} from "@/lib/repos/inventory";
import { clearCart } from "@/lib/repos/cart";
import { notifyOrderStatus } from "@/lib/notifications";
import { enqueueOrderEvent } from "@/lib/erp-bridge";
import { generateInvoiceForOrder } from "@/lib/repos/invoices";
import { recordCouponUsage } from "@/lib/cart-coupon";
import type { NormalizedGatewayResult } from "@/lib/ccavenue";

export type FinalizeSource = "callback" | "status-poll" | "cron-reconcile";

export type FinalizeResult =
  | {
      kind: "no-change";
      reason: "already_finalized" | "still_pending" | "unknown_status";
      orderId: string;
      paymentStatus: "pending" | "paid" | "failed" | "refunded";
    }
  | {
      kind: "marked-paid";
      orderId: string;
      orderNumber: string;
      parentId: string;
    }
  | {
      kind: "marked-failed";
      orderId: string;
      reason: string;
    };

/**
 * Re-format Date → CCAvenue-style "DD/MM/YYYY HH:MM:SS" string so existing
 * audit tooling that reads `payments.payment_date` keeps working when the
 * value came from the Status API path instead of the callback path.
 */
function formatPaymentDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Single entry point that callers (callback route, parent-status route,
 * reconciler cron) use to apply CCAvenue's verdict to local state.
 */
export async function finalizeOrderPayment(args: {
  orderId: string;
  source: FinalizeSource;
  normalized: NormalizedGatewayResult;
}): Promise<FinalizeResult> {
  const { orderId, source, normalized } = args;

  // Snapshot the current payment + order so we can guard against double-
  // firing without trusting the input. Two callers can race here; the
  // first one to flip `payment_finalized=true` wins, the rest become
  // no-ops.
  const [snap] = await db
    .select({
      paymentStatus: payments.status,
      paymentFinalized: payments.paymentFinalized,
      orderTotal: orders.total,
      orderNumber: orders.orderNumber,
      parentId: orders.parentId,
      // Coupon reservation written by create-order. Promoted to a
      // website_cart_coupon_usages row in the paid path below.
      couponId: orders.couponId,
      orderDiscount: orders.discount,
      studentId: orders.studentId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(eq(payments.orderId, orderId))
    .limit(1);

  if (!snap) {
    // Order or payment row vanished between caller's lookup and here.
    return {
      kind: "no-change",
      reason: "unknown_status",
      orderId,
      paymentStatus: "pending",
    };
  }

  if (snap.paymentFinalized) {
    return {
      kind: "no-change",
      reason: "already_finalized",
      orderId,
      paymentStatus: snap.paymentStatus,
    };
  }

  if (normalized.status === "pending") {
    return {
      kind: "no-change",
      reason: "still_pending",
      orderId,
      paymentStatus: snap.paymentStatus,
    };
  }

  if (normalized.status === "unknown") {
    // CCAvenue returned a state we don't act on (Refunded / Chargeback /
    // System refund / parse error). Don't flip state; just log via the
    // return value so admin tooling can investigate.
    return {
      kind: "no-change",
      reason: "unknown_status",
      orderId,
      paymentStatus: snap.paymentStatus,
    };
  }

  if (normalized.status === "failed") {
    await db
      .update(payments)
      .set({
        status: "failed",
        gatewayResponseMessage:
          normalized.rawStatus ||
          `ccavenue_${normalized.status} (via ${source})`,
        gatewayTrackingId: normalized.trackingId,
        paymentFinalized: true,
        raw: normalized.rawResponse,
        lastStatusPollAt: source === "callback" ? undefined : new Date(),
      })
      .where(eq(payments.orderId, orderId));
    await db
      .update(orders)
      .set({ paymentStatus: "failed" })
      .where(eq(orders.id, orderId));
    return {
      kind: "marked-failed",
      orderId,
      reason: normalized.rawStatus || "ccavenue_failed",
    };
  }

  // ── Paid path ─────────────────────────────────────────────────────
  const now = new Date();
  // Look up whether this order is part of a sibling group. If yes, mark
  // every order sharing the orderGroupId as paid + confirmed in one
  // statement so per-sibling orders all settle on a single payment.
  const [primary] = await db
    .select({ orderGroupId: orders.orderGroupId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (primary?.orderGroupId) {
    await db
      .update(orders)
      .set({
        paymentStatus: "paid",
        status: "confirmed",
        confirmedAt: now,
      })
      .where(eq(orders.orderGroupId, primary.orderGroupId));
  } else {
    await db
      .update(orders)
      .set({
        paymentStatus: "paid",
        status: "confirmed",
        confirmedAt: now,
      })
      .where(eq(orders.id, orderId));
  }

  await db
    .update(payments)
    .set({
      status: "paid",
      method: "ccavenue",
      paymentMode: normalized.paymentMode ?? "CCAvenue",
      paymentDate: normalized.paymentDate ?? formatPaymentDate(now),
      paidAmount:
        normalized.paidAmount ?? ((snap.orderTotal ?? 0) / 100).toFixed(2),
      paidCurrency: "INR",
      gatewayProvider: "CCAVENUE",
      gatewayTrackingId: normalized.trackingId,
      gatewayResponseMessage: `success:${normalized.trackingId ?? ""} (via ${source})`,
      paymentFinalized: true,
      raw: normalized.rawResponse,
      lastStatusPollAt: source === "callback" ? undefined : new Date(),
    })
    .where(eq(payments.orderId, orderId));

  // Atomic stock decrement. Failures (negative stock, missing warehouse,
  // ledger constraint) are logged for ops but DO NOT downgrade the order
  // status — payment succeeded, so customer-facing state must stay
  // `confirmed`. The earlier rollback to `placed` was confusing for users
  // and triggered every time we sold a variant that had no stock ledger
  // entries seeded yet. Inventory reconciliation is an ops concern,
  // surfaced via container logs (and any downstream alerting on them).
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  try {
    const wh = await getDefaultWarehouseId();
    await db.transaction(async () => {
      for (const it of items) {
        await applyStockChange({
          variantId: it.variantId,
          warehouseId: wh,
          delta: -it.qty,
          reason: "shipment_out",
          refType: "order",
          refId: orderId,
        });
      }
    });
  } catch (e) {
    console.error(
      `[ccavenue-finalize] stock decrement failed for order ${orderId} (source=${source}) — order remains confirmed, inventory needs ops review:`,
      e
    );
  }

  // ── Promote coupon reservation → audit row ─────────────────────────
  // Only fires on payment-success; failed payments leave orders.coupon_id
  // intact but never write a usages row, so the coupon remains reusable.
  // Idempotent: the outer paymentFinalized guard prevents this block from
  // running twice for the same order. An extra existence check defends
  // against race conditions across competing finalize callers.
  if (snap.couponId) {
    try {
      const [existing] = await db
        .select({ id: websiteCartCouponUsages.id })
        .from(websiteCartCouponUsages)
        .where(eq(websiteCartCouponUsages.orderId, orderId))
        .limit(1);
      if (!existing) {
        const [stu] = snap.studentId
          ? await db
              .select({
                name: students.name,
                firstName: students.firstName,
                lastName: students.lastName,
              })
              .from(students)
              .where(eq(students.id, snap.studentId))
              .limit(1)
          : [null];
        const customerName = stu
          ? [stu.firstName, stu.lastName].filter(Boolean).join(" ").trim() ||
            stu.name
          : null;
        await recordCouponUsage({
          couponId: snap.couponId,
          parentId: snap.parentId,
          orderId,
          amountSavedPaise: snap.orderDiscount ?? 0,
          customerName,
          orderAmountPaise: snap.orderTotal ?? null,
          transactionDate: now,
        });
      }
    } catch (e) {
      console.error(
        `[ccavenue-finalize] coupon usage record failed for ${orderId} — order remains confirmed:`,
        e,
      );
    }
  }

  await clearCart(snap.parentId);
  void notifyOrderStatus(orderId, "confirmed");
  void enqueueOrderEvent(orderId, "order.created");
  // Auto-generate the GST invoice now that payment is confirmed. Wrapped
  // in fire-and-forget so a transient invoice-gen failure (e.g. tax
  // calculation hiccup) doesn't roll back the customer-visible
  // "marked-paid" response. The admin /invoices page surfaces failures.
  void generateInvoiceForOrder({ orderId }).catch((e) =>
    console.error(`[ccavenue-finalize] auto-invoice failed for ${orderId}:`, e)
  );

  return {
    kind: "marked-paid",
    orderId,
    orderNumber: snap.orderNumber,
    parentId: snap.parentId,
  };
}
