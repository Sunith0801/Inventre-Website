/**
 * Parent-side polling endpoint. The order detail page hits this while
 * `payments.status === 'pending'` so a parent who landed on the order
 * page mid-flight (browser closed before callback, mobile dropped the
 * redirect, etc.) sees the real outcome within seconds rather than a
 * stuck "pending" forever.
 *
 *   POST /api/checkout/ccavenue/status/<orderId>
 *
 * Auth: parent session; the route enforces that the order belongs to
 * the requesting parent so one parent can't poke at another's payments.
 *
 * If `payment_finalized=true` already, we short-circuit (no CCAvenue
 * call). Otherwise we throttle to one Status API hit per 5 s per order
 * by checking `payments.last_status_poll_at` — important when several
 * tabs poll the same order or back-off math gets aggressive.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, payments } from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import {
  fetchCCAvenueOrderStatus,
  isCCAvenueConfigured,
} from "@/lib/ccavenue";
import { finalizeOrderPayment } from "@/lib/ccavenue-finalize";

const THROTTLE_MS = 5_000;

type Body = {
  status: "paid" | "failed" | "pending" | "unknown";
  finalized: boolean;
  checkedAt: string;
  /** Present when the poll was rate-limited; client should back off. */
  throttled?: true;
  /** Non-fatal note (e.g. CCAvenue 5xx, decrypt failed). */
  note?: string;
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const me = await getCurrentParent();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId } = await params;

  const [snap] = await db
    .select({
      parentId: orders.parentId,
      orderNumber: orders.orderNumber,
      paymentStatus: payments.status,
      paymentFinalized: payments.paymentFinalized,
      gatewayTrackingId: payments.gatewayTrackingId,
      lastStatusPollAt: payments.lastStatusPollAt,
    })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!snap) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (snap.parentId !== me.id) {
    // Don't disclose existence to a non-owner — match the 404 shape.
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const now = new Date();
  const respond = (b: Body) => NextResponse.json(b);

  // Already finalised — return the stored verdict, no API call.
  if (snap.paymentFinalized) {
    return respond({
      status:
        snap.paymentStatus === "paid"
          ? "paid"
          : snap.paymentStatus === "failed"
            ? "failed"
            : snap.paymentStatus === "refunded"
              ? "unknown"
              : "pending",
      finalized: true,
      checkedAt: now.toISOString(),
    });
  }

  // Throttle to once per 5 s per order — protects CCAvenue + ourselves
  // from a parent's runaway polling loop / multiple tabs racing.
  if (
    snap.lastStatusPollAt &&
    now.getTime() - snap.lastStatusPollAt.getTime() < THROTTLE_MS
  ) {
    return respond({
      status: snap.paymentStatus as Body["status"],
      finalized: false,
      checkedAt: snap.lastStatusPollAt.toISOString(),
      throttled: true,
    });
  }

  if (!isCCAvenueConfigured()) {
    return respond({
      status: snap.paymentStatus as Body["status"],
      finalized: false,
      checkedAt: now.toISOString(),
      note: "CCAvenue not configured on this environment",
    });
  }

  // Mark the poll attempt up-front so a failed CCAvenue call still
  // counts toward the throttle (otherwise a hard-down gateway would let
  // parents hammer us).
  await db
    .update(payments)
    .set({ lastStatusPollAt: now })
    .where(eq(payments.orderId, orderId));

  let result;
  try {
    const normalized = await fetchCCAvenueOrderStatus({
      referenceNo: snap.gatewayTrackingId ?? null,
      orderNo: snap.orderNumber,
    });
    result = await finalizeOrderPayment({
      orderId,
      source: "status-poll",
      normalized,
    });
  } catch (e) {
    return respond({
      status: snap.paymentStatus as Body["status"],
      finalized: false,
      checkedAt: now.toISOString(),
      note: e instanceof Error ? e.message : "status-api call failed",
    });
  }

  if (result.kind === "marked-paid") {
    return respond({ status: "paid", finalized: true, checkedAt: now.toISOString() });
  }
  if (result.kind === "marked-failed") {
    return respond({ status: "failed", finalized: true, checkedAt: now.toISOString() });
  }
  // no-change: either CCAvenue still says pending, or the gateway response
  // was a state we don't act on (Refunded/Chargeback/parse error).
  return respond({
    status: result.paymentStatus === "paid" ? "paid" : result.paymentStatus === "failed" ? "failed" : "pending",
    finalized: result.reason === "already_finalized",
    checkedAt: now.toISOString(),
    note: result.reason,
  });
}
