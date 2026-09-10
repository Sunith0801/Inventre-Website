import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orderItems,
  orders,
  payments,
  productVariants,
  products,
} from "@/db/schema";

/**
 * Read-only eligibility helpers for the customer "My Orders" page.
 *
 * The page needs to know whether an abandoned / never-paid checkout can be
 * re-ordered. For a Magic Box that depends on the ONE-PER-STUDENT lifetime
 * limit — so we replicate the order-history blocking rule from the cart's
 * `checkMagicBoxLimit` (app/api/cart/route.ts).
 *
 * ⚠️ KEEP IN SYNC with app/api/cart/route.ts `checkMagicBoxLimit` /
 * `pendingPaymentHasMoneyInPlay`. We deliberately DUPLICATE rather than
 * import from the cart route: the cart route is the checkout-critical path
 * and a read-only page must never be able to change (or break) it. This
 * module only ever READS. If a page shows the button when the cart would
 * actually block, the worst case is identical to today's behaviour (the
 * cart still rejects on add) — never a checkout regression.
 */

// A pending magic-box order keeps the slot only while it's a LIVE payment.
// 1h comfortably covers an active checkout and any real gateway settlement;
// an abandoned "Initiated" attempt never resolves and is older than this.
const FRESH_PENDING_MS = 60 * 60 * 1000;

/** True when a pending payment has money actually in play — debited and
 *  settling ("Awaited"/"Auto-Reversed"), or captured but not yet latched to
 *  paid ("Successful"). Anything else — notably "Initiated" — means no money
 *  was debited. Mirrors the cart route's helper of the same name. */
function pendingPaymentHasMoneyInPlay(
  message: string | null | undefined,
  raw: unknown,
): boolean {
  const msg = (message ?? "").toLowerCase();
  if (/\bsuccess\b/.test(msg)) return true; // latch-bug shape: "success:<id> …"
  let status = "";
  const m = msg.match(/status=([a-z-]+)/i);
  if (m) {
    status = m[1];
  } else if (raw && typeof raw === "object") {
    const os = (raw as Record<string, unknown>).order_status;
    if (typeof os === "string") status = os;
  }
  const s = status.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return (
    s === "awaited" ||
    s === "autoreversed" ||
    s === "successful" ||
    s === "success" ||
    s === "shipped"
  );
}

/**
 * Does this student's single Magic Box slot already count as taken?
 * Mirrors the order-history half of `checkMagicBoxLimit`: a non-cancelled,
 * non-failed magic_box order blocks when it is paid/refunded, or pending +
 * fresh, or pending + money-in-play. Abandoned "Initiated" attempts do NOT
 * block (they free the slot), so this returns false for them.
 */
export async function magicBoxSlotBlocked(
  parentId: string,
  studentId: string | null,
): Promise<boolean> {
  if (!studentId) return false;

  const priorRows = await db
    .select({
      orderId: orders.id,
      paymentStatus: orders.paymentStatus,
      orderCreatedAt: orders.createdAt,
      payCreatedAt: payments.createdAt,
      payMessage: payments.gatewayResponseMessage,
      payRaw: payments.raw,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(
      and(
        eq(orders.parentId, parentId),
        eq(orders.studentId, studentId),
        eq(products.kind, "magic_box"),
        ne(orders.status, "cancelled"),
        ne(orders.paymentStatus, "failed"),
      ),
    );

  // Collapse to one row per order, keeping its most-recent payment.
  const latestByOrder = new Map<string, (typeof priorRows)[number]>();
  for (const r of priorRows) {
    const prev = latestByOrder.get(r.orderId);
    const t = r.payCreatedAt ? new Date(r.payCreatedAt).getTime() : 0;
    const pt = prev?.payCreatedAt ? new Date(prev.payCreatedAt).getTime() : -1;
    if (!prev || t > pt) latestByOrder.set(r.orderId, r);
  }

  const now = Date.now();
  return Array.from(latestByOrder.values()).some((r) => {
    // failed/cancelled are filtered out above → non-pending here is paid or
    // refunded, both of which block.
    if (r.paymentStatus !== "pending") return true;
    const created = r.orderCreatedAt ? new Date(r.orderCreatedAt).getTime() : 0;
    const fresh = created > 0 && now - created < FRESH_PENDING_MS;
    return fresh || pendingPaymentHasMoneyInPlay(r.payMessage, r.payRaw);
  });
}

/** True when the given local order contains at least one magic_box line. */
export async function orderHasMagicBox(orderId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(eq(orderItems.orderId, orderId), eq(products.kind, "magic_box")),
    )
    .limit(1);
  return !!row;
}

/**
 * Resolve the customer-facing placement extras for one order:
 *   • paymentStatusRaw — the raw CCAvenue word (payments.gatewayResponseMessage)
 *     so the page can show "Initiated" / "Aborted" / "Awaited" + its meaning.
 *   • canReorder       — false when re-ordering is now impossible because a
 *     one-per-student item (Magic Box) is already placed for this student.
 *
 * Ownership is NOT re-checked here: the caller (the order-detail API route)
 * only reaches this after getParentOrderDetail* already authorised the order
 * for `me`, so resolving the local row by id/number alone is safe and also
 * works for split-account / guest orders.
 */
export async function getOrderPlacementInfo(
  idOrNumber: string,
): Promise<{ paymentStatusRaw: string | null; canReorder: boolean }> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  const [lo] = await db
    .select({
      id: orders.id,
      studentId: orders.studentId,
      parentId: orders.parentId,
    })
    .from(orders)
    .where(isUuid ? eq(orders.id, idOrNumber) : eq(orders.orderNumber, idOrNumber))
    .limit(1);
  if (!lo) return { paymentStatusRaw: null, canReorder: true };

  const [pay] = await db
    .select({ msg: payments.gatewayResponseMessage })
    .from(payments)
    .where(eq(payments.orderId, lo.id))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  let canReorder = true;
  if (await orderHasMagicBox(lo.id)) {
    if (await magicBoxSlotBlocked(lo.parentId, lo.studentId)) canReorder = false;
  }

  return { paymentStatusRaw: pay?.msg ?? null, canReorder };
}
