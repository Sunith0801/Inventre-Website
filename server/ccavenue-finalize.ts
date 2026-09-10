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
import { and, eq, ne, sql } from "drizzle-orm";
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
} from "@/server/repos/inventory";
import { clearCart } from "@/server/repos/cart";
import { notifyOrderConfirmed } from "@/server/order-confirmation";
import { enqueueOrderEvent } from "@/server/erp-bridge";
import { generateInvoiceForOrder } from "@/server/repos/invoices";
import { recordCouponUsage } from "@/server/cart-coupon";
import type { NormalizedGatewayResult } from "@/server/ccavenue";

export type FinalizeSource =
  | "callback"
  | "status-poll"
  | "cron-reconcile"
  | "settlement-reconcile";

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

  // Verdicts that never mutate local state, regardless of the local row.
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

  // A terminal SUCCESS (paid / refunded) is final — never re-run the paid
  // side effects, and never let a late `failed` verdict downgrade a captured
  // payment. This REPLACES the old blanket `payment_finalized` guard, which
  // also latched on a FAILED first attempt and so silently swallowed the
  // success callback of a retry (CCAvenue reuses the same order_id across
  // retries → the retry's `paid` callback hit the latch and was dropped,
  // leaving money captured but the order stuck `failed`). Gating on the
  // actual payment STATUS instead lets a `paid` verdict heal a previously
  // failed+finalized order through the paid path below.
  if (snap.paymentStatus === "paid" || snap.paymentStatus === "refunded") {
    return {
      kind: "no-change",
      reason: "already_finalized",
      orderId,
      paymentStatus: snap.paymentStatus,
    };
  }

  if (normalized.status === "failed") {
    // Already recorded as failed — don't rewrite the row (keep the first
    // failure's forensic trail and avoid status churn). A later `paid`
    // verdict for the same order can still heal it via the paid path.
    if (snap.paymentStatus === "failed") {
      return {
        kind: "no-change",
        reason: "already_finalized",
        orderId,
        paymentStatus: "failed",
      };
    }
    const failNow = new Date();
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

    // Fan the failure out to the whole basket — symmetric with the paid
    // path below. Historically the failed path only marked the primary
    // order, so siblings of a failed shared-basket payment kept
    // paymentStatus='pending' with no payments row, and showed a blank
    // payment status on the website + audit (only 1 of N siblings reflected
    // FAILED — the "— on the sibling" reports). Mark every sibling failed
    // (never downgrade an already-paid sibling), copy the gateway fields
    // onto a per-sibling failed payments row, and push each to audit.
    const [failGrp] = await db
      .select({ orderGroupId: orders.orderGroupId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (failGrp?.orderGroupId) {
      await db
        .update(orders)
        .set({ paymentStatus: "failed" })
        .where(
          and(
            eq(orders.orderGroupId, failGrp.orderGroupId),
            ne(orders.paymentStatus, "paid")
          )
        );
      await db.execute(sql`
        INSERT INTO payments (
          order_id, provider, gateway_provider, gateway_order_id,
          internal_payment_reference, amount, status, payment_flow,
          method, payment_mode, payment_date, paid_amount, paid_currency,
          gateway_tracking_id, gateway_response_message, payment_finalized,
          refund_status, payment_attempt_count, payment_retry_count, raw
        )
        SELECT
          sib.id, 'ccavenue', 'CCAVENUE', sib.order_number,
          ${`sibling-of:${orderId}`}, sib.total, 'failed'::payment_status, 'ONLINE',
          'ccavenue', ${normalized.paymentMode ?? "CCAvenue"},
          ${normalized.paymentDate ?? formatPaymentDate(failNow)},
          '0', 'INR',
          ${normalized.trackingId ?? null},
          ${`sibling-of:${orderId} ccavenue_failed (via ${source})`},
          true, 'NOT_REQUESTED', 1, 0,
          ${normalized.rawResponse != null ? JSON.stringify(normalized.rawResponse) : null}::jsonb
        FROM orders sib
        WHERE sib.order_group_id = ${failGrp.orderGroupId}
          AND sib.id <> ${orderId}
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = sib.id)
      `);
      const sibs = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderGroupId, failGrp.orderGroupId));
      // Awaited, not `void` — see the note on the paid-path enqueue below.
      for (const s of sibs) await enqueueOrderEvent(s.id, "order.updated");
    } else {
      await db
        .update(orders)
        .set({ paymentStatus: "failed" })
        .where(eq(orders.id, orderId));
      await enqueueOrderEvent(orderId, "order.updated");
    }
    return {
      kind: "marked-failed",
      orderId,
      reason: normalized.rawStatus || "ccavenue_failed",
    };
  }

  // ── Paid path (status was pending, or a retry success healing a
  //    previously failed+finalized order) ─────────────────────────────
  const now = new Date();

  // Atomically CLAIM the paid transition on the primary payment row. The
  // `status <> 'paid'` predicate makes this both:
  //   * race-safe — only the caller whose UPDATE actually flips the row
  //     runs the one-time side effects below; a concurrent callback /
  //     status-poll / cron caller claims 0 rows and bails as a no-op
  //     (this also replaces the old read-then-write payment_finalized latch).
  //   * self-healing — it transitions `failed` → `paid` for a retry whose
  //     success arrived after the first attempt's failure latched the row.
  const claimed = await db
    .update(payments)
    .set({
      status: "paid",
      method: "ccavenue",
      paymentMode: normalized.paymentMode ?? "CCAvenue",
      paymentDate: normalized.paymentDate ?? formatPaymentDate(now),
      // Always use the primary order's own total for paid_amount, never the
      // gateway-reported amount (which is the basket total in multi-sibling
      // baskets — would inflate the primary's per-order display).
      // payment.amount stays per-order too (see create-order/route.ts:308),
      // so SUM across the group still equals the gateway capture.
      paidAmount: ((snap.orderTotal ?? 0) / 100).toFixed(2),
      paidCurrency: "INR",
      gatewayProvider: "CCAVENUE",
      gatewayTrackingId: normalized.trackingId,
      gatewayResponseMessage: `success:${normalized.trackingId ?? ""} (via ${source})`,
      paymentFinalized: true,
      raw: normalized.rawResponse,
      lastStatusPollAt: source === "callback" ? undefined : new Date(),
    })
    .where(and(eq(payments.orderId, orderId), ne(payments.status, "paid")))
    .returning({ id: payments.id });

  if (claimed.length === 0) {
    // Another finalize caller already flipped this order to paid (or it was
    // paid before we read the snapshot). The winning caller runs the side
    // effects; we bail as a no-op so they don't run twice.
    return {
      kind: "no-change",
      reason: "already_finalized",
      orderId,
      paymentStatus: "paid",
    };
  }

  // We won the claim → settle the order(s) and run the one-time side effects.
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

  // Fan the captured payment out to every sibling order in the basket.
  // The order-status update above already flips each sibling to
  // paid+confirmed, but historically only the primary got a `payments`
  // row — siblings ended up with "No payment row recorded yet" in the
  // admin and zero CCAvenue trace (root cause of the missing-payment-
  // row reports on 2026-06-04). Copy the primary's gateway fields onto
  // a per-sibling row, scoped to the sibling's own order_id, total, and
  // order_number. NOT EXISTS keeps the insert idempotent against the
  // race where two finalize callers (callback + status-poll) fire
  // concurrently.
  //
  // The insert alone is not enough. A sibling can already OWN a payments
  // row that says `failed`, written by the failed fan-out above when an
  // earlier attempt returned a terminal failure — the classic shape is a
  // parent who pays, then re-submits the checkout page: CCAvenue aborts
  // the duplicate ("Payment already done"), we fan that failure out, and
  // the reconciler only later re-polls and finds the real capture. In
  // that order NOT EXISTS saw a row, skipped, and left the sibling stuck
  // at failed/0.00 forever while its order said paid — the website and
  // audit then showed one child's order paid and the other's FAILED off a
  // single captured payment (SAL-ORD-2026-40412, 2026-08-08). Promote any
  // non-paid sibling row first: a paid verdict must always win over an
  // earlier failed one, exactly as it does for the order row itself.
  if (primary?.orderGroupId) {
    await db.execute(sql`
      UPDATE payments p SET
        status = 'paid'::payment_status,
        paid_amount = to_char(sib.total::numeric / 100, 'FM999999990.00'),
        payment_mode = ${normalized.paymentMode ?? "CCAvenue"},
        payment_date = ${normalized.paymentDate ?? formatPaymentDate(now)},
        gateway_tracking_id = COALESCE(${normalized.trackingId ?? null}, p.gateway_tracking_id),
        internal_payment_reference = ${orderId},
        gateway_response_message = ${`sibling-of:${orderId} success:${normalized.trackingId ?? ""} (via ${source})`},
        payment_finalized = true,
        raw = COALESCE(
          ${normalized.rawResponse != null ? JSON.stringify(normalized.rawResponse) : null}::jsonb,
          p.raw
        )
      FROM orders sib
      WHERE p.order_id = sib.id
        AND sib.order_group_id = ${primary.orderGroupId}
        AND sib.id <> ${orderId}
        AND p.status <> 'paid'::payment_status
    `);
    await db.execute(sql`
      INSERT INTO payments (
        order_id, provider, gateway_provider, gateway_order_id,
        internal_payment_reference, amount, status, payment_flow,
        method, payment_mode, payment_date, paid_amount, paid_currency,
        gateway_tracking_id, gateway_response_message, payment_finalized,
        refund_status, payment_attempt_count, payment_retry_count, raw
      )
      SELECT
        sib.id, 'ccavenue', 'CCAVENUE', sib.order_number,
        ${orderId}, sib.total, 'paid'::payment_status, 'ONLINE',
        'ccavenue', ${normalized.paymentMode ?? "CCAvenue"},
        ${normalized.paymentDate ?? formatPaymentDate(now)},
        to_char(sib.total::numeric / 100, 'FM999999990.00'), 'INR',
        ${normalized.trackingId ?? null},
        ${`sibling-of:${orderId} success:${normalized.trackingId ?? ""} (via ${source})`},
        true, 'NOT_REQUESTED', 1, 0,
        ${normalized.rawResponse != null ? JSON.stringify(normalized.rawResponse) : null}::jsonb
      FROM orders sib
      WHERE sib.order_group_id = ${primary.orderGroupId}
        AND sib.id <> ${orderId}
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = sib.id)
    `);
  }

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
        // A line with no variant is not stock (bookkits, magic boxes): there is no
        // bin to move. Passing null matched no bin and inserted one with a null
        // variant — the phantom 0/0 rows cleaned out of production in July.
        if (!it.variantId) continue;
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
  // DLT-backed SMS + email per order (siblings fanned out inside; the
  // order_notifications log doubles as the cross-path idempotency guard).
  // MUST be awaited, not fire-and-forget: callers return their HTTP response
  // (the callback route redirects) the instant finalize resolves, and the
  // Next runtime drops any still-pending floating promise — so a `void` here
  // silently never sent the SMS/email (confirmed in prod 2026-06-13).
  // notifyOrderConfirmed is best-effort internally and never throws, so
  // awaiting it can't downgrade the order.
  await notifyOrderConfirmed(orderId);
  // Multi-school baskets settle one CCAvenue payment against multiple
  // sibling orders sharing an orderGroupId (see the update block above).
  // Audit needs to learn about each sibling, not just the primary; missing
  // siblings used to silently vanish from audit.inventre.in.
  // MUST be awaited, not `void`, for the same reason notifyOrderConfirmed is
  // (see above): the enqueue is an async INSERT, and every caller tears down
  // the moment finalize resolves — the Next runtime drops a still-pending
  // floating promise once the response is returned, and the tsx ops CLIs call
  // process.exit(0) outright. A `void` here meant the queue row was never
  // written and the order silently never reached audit (confirmed in prod
  // 2026-07-18: healing SAL-ORD-2026-32011 via the settlement-reconcile CLI
  // left erp_outbound_queue with ZERO rows for it). enqueueOrderEvent swallows
  // its own errors and returns null, so awaiting can't downgrade the order.
  if (primary?.orderGroupId) {
    const siblings = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderGroupId, primary.orderGroupId));
    for (const sib of siblings) {
      await enqueueOrderEvent(sib.id, "order.created");
    }
  } else {
    await enqueueOrderEvent(orderId, "order.created");
  }
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
