import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, payments } from "@/db/schema";
import { requirePermission, isResponse, assertSchoolAccess } from "@/lib/admin-guard";
import { fetchCCAvenueOrderStatus } from "@/lib/ccavenue";
import { finalizeOrderPayment } from "@/lib/ccavenue-finalize";
import { logAdminActivity } from "@/lib/activity";

/**
 * Live-refresh the CCAvenue reference for a single order. Hits
 * CCAvenue's Status API (`orderStatusTracker` command, see
 * `lib/ccavenue.ts:fetchCCAvenueOrderStatus`) and merges the response
 * into the local `payments` row so the order detail page reflects
 * whatever CCAvenue currently knows about the transaction. Used by the
 * "Refresh from CCAvenue" chip — admins can pull fresh values when:
 *
 *   - A pending payment finally succeeded but the webhook never landed,
 *   - The tracking_id is missing because the order was created before
 *     we started persisting it,
 *   - Ops need to verify the gateway's view matches the local row
 *     before processing a refund.
 *
 * Auth: super or ops. Read-only against ERP but mutates `payments`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  // The detail page links use orderNumber (e.g. SAL-ORD-2026-27089) or
  // the local uuid — accept both. The orders.id column is uuid, the
  // orderNumber column is text.
  const decoded = decodeURIComponent(id);
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded);
  const [order] = isUuid
    ? await db.select().from(orders).where(eq(orders.id, decoded)).limit(1)
    : await db.select().from(orders).where(eq(orders.orderNumber, decoded)).limit(1);
  if (!order) {
    return NextResponse.json({ error: "Order not found in local DB" }, { status: 404 });
  }
  // School scope: a school_admin may only act on their own school's orders.
  const denied = assertSchoolAccess(guard, order.schoolId);
  if (denied) return denied;

  const [paymentRow] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .orderBy(payments.createdAt)
    .limit(1);

  // CCAvenue's Status API needs the same order_no we sent at session-init
  // time. buildRedirectPayload sends orders.id (the UUID) as order_id, not
  // orders.order_number — so we must look up by UUID here too, otherwise
  // CCAvenue returns "No Record Found".
  let result;
  try {
    result = await fetchCCAvenueOrderStatus({
      orderNo: order.id,
      referenceNo: paymentRow?.gatewayTrackingId ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `CCAvenue Status API call failed: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 502 }
    );
  }

  // If CCAvenue says this order is PAID but our local row isn't, this is a
  // captured-but-stranded payment (the success callback never landed, or a
  // retry's success was swallowed by the old finalize latch). Run the shared
  // finaliser so the order actually SETTLES — order→confirmed, stock
  // decrement, SMS, invoice, ERP push — instead of only cosmetically
  // patching the payment row (which is what left rows showing a success ref +
  // paid_amount on a still-`failed` order).
  if (result.status === "paid" && order.paymentStatus !== "paid") {
    const fin = await finalizeOrderPayment({
      orderId: order.id,
      source: "status-poll",
      normalized: result,
    });
    revalidatePath(`/admin/orders/${encodeURIComponent(order.orderNumber)}`);
    revalidatePath(`/admin/orders/${order.id}`);
    revalidatePath("/admin/orders");
    void logAdminActivity(guard, {
      action: "order.refresh_cca",
      entityType: "order",
      entityId: order.id,
      summary: `Refreshed from CCAvenue → finalized (${fin.kind}); status ${result.rawStatus}`,
      req,
    });
    return NextResponse.json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      finalized: fin.kind,
      status: result.status,
      rawStatus: result.rawStatus,
      trackingId: result.trackingId,
      paidAmount: result.paidAmount,
      paymentMode: result.paymentMode,
      paymentDate: result.paymentDate,
    });
  }

  // GUARD: never let a non-paid poll clobber an already-CAPTURED payment.
  // CCAvenue's Status API keyed on order_no returns the LATEST transaction —
  // for an order the parent retried, that's the ABORTED retry, not the earlier
  // successful capture we finalised against (which carries a different
  // reference_no). Overwriting a `paid` row's tracking id / amount / date with
  // that aborted result made healed orders keep flipping back to "Aborted"
  // (ref 114584087161) on every Refresh click, even though payment_status
  // stayed `paid`. When the local row is already paid and the gateway poll is
  // NOT paid, record only that a poll happened — keep the captured values.
  if (paymentRow && paymentRow.status === "paid" && result.status !== "paid") {
    await db
      .update(payments)
      .set({ lastStatusPollAt: new Date() })
      .where(eq(payments.id, paymentRow.id));
    revalidatePath(`/admin/orders/${encodeURIComponent(order.orderNumber)}`);
    revalidatePath(`/admin/orders/${order.id}`);
    revalidatePath("/admin/orders");
    void logAdminActivity(guard, {
      action: "order.refresh_cca",
      entityType: "order",
      entityId: order.id,
      summary: `Refreshed from CCAvenue; poll=${result.rawStatus} but payment already captured — kept ref ${paymentRow.gatewayTrackingId}`,
      req,
    });
    return NextResponse.json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      status: "paid",
      // Show a reassuring label in the admin chip. The gateway's order_no
      // poll returns the aborted retry (result.rawStatus), but the payment
      // is captured — don't surface the scary "Aborted" word. The detail
      // is kept in `note` for API consumers.
      rawStatus: "Paid (captured)",
      note: `gateway poll returned ${result.rawStatus} (aborted retry) — captured payment left intact`,
      trackingId: paymentRow.gatewayTrackingId,
      paidAmount: paymentRow.paidAmount,
      paymentMode: paymentRow.paymentMode,
      paymentDate: paymentRow.paymentDate,
    });
  }

  // Merge fields onto the payment row only when CCAvenue returned a
  // meaningful value. Don't overwrite an existing trackingId with null —
  // CCAvenue sometimes returns blank fields for paid orders if the lookup
  // hit an inconsistent shard. Keep what we already had in that case.
  if (paymentRow) {
    const patch: Record<string, unknown> = {};
    if (result.trackingId && result.trackingId !== paymentRow.gatewayTrackingId) {
      patch.gatewayTrackingId = result.trackingId;
    }
    if (result.paidAmount && result.paidAmount !== paymentRow.paidAmount) {
      patch.paidAmount = result.paidAmount;
    }
    if (result.paymentDate && result.paymentDate !== paymentRow.paymentDate) {
      patch.paymentDate = result.paymentDate;
    }
    if (result.paymentMode && result.paymentMode !== paymentRow.paymentMode) {
      patch.paymentMode = result.paymentMode;
    }
    if (result.bankRef) {
      // bankRef goes onto gatewayResponseMessage as a forensic tail; we
      // don't have a dedicated column for it.
      patch.gatewayResponseMessage =
        `CCAvenue refresh ${new Date().toISOString()}: status=${result.rawStatus} bankRef=${result.bankRef}`;
    } else {
      patch.gatewayResponseMessage =
        `CCAvenue refresh ${new Date().toISOString()}: status=${result.rawStatus}`;
    }
    patch.lastStatusPollAt = new Date();

    if (Object.keys(patch).length > 1 /* at least one real field changed */) {
      await db.update(payments).set(patch).where(eq(payments.id, paymentRow.id));
    }
  }

  revalidatePath(`/admin/orders/${encodeURIComponent(order.orderNumber)}`);
  revalidatePath(`/admin/orders/${order.id}`);
  revalidatePath("/admin/orders");

  void logAdminActivity(guard, {
    action: "order.refresh_cca",
    entityType: "order",
    entityId: order.id,
    summary: `Refreshed from CCAvenue; status ${result.rawStatus}`,
    req,
  });

  return NextResponse.json({
    ok: true,
    refreshedAt: new Date().toISOString(),
    status: result.status,
    rawStatus: result.rawStatus,
    trackingId: result.trackingId,
    paidAmount: result.paidAmount,
    paymentMode: result.paymentMode,
    paymentDate: result.paymentDate,
  });
}
