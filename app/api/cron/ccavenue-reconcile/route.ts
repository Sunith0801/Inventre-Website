/**
 * Server-side sweeper for CCAvenue orders stuck in `payment_status='pending'`.
 *
 * Parents whose browser closed mid-redirect (or whose webhook never
 * landed) won't poll us — we have to poll CCAvenue ourselves to keep
 * the order ledger truthful and decrement stock for sales that actually
 * happened.
 *
 * Cadence: meant to be invoked once a minute by the host cron (same
 * mechanism that hits the other /api/cron/* routes). Cheap when there
 * are no stuck rows; capped at 50 lookups per run when there are.
 *
 *   GET  /api/cron/ccavenue-reconcile
 *   Auth: Authorization: Bearer <CRON_TOKEN>
 *
 * Matches the auth shape of the existing retry-webhooks cron so the host
 * scheduler can use the same secret.
 */
import { NextResponse } from "next/server";
import { requireCron } from "@/server/cron-auth";
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, payments } from "@/db/schema";
import {
  fetchCCAvenueOrderStatus,
  isCCAvenueConfigured,
} from "@/server/ccavenue";
import { finalizeOrderPayment } from "@/server/ccavenue-finalize";

const BATCH_LIMIT = 50;
/** Min time between polls per order. */
const PER_ORDER_COOLDOWN = sql`interval '5 minutes'`;
/** Wait this long after the order was created before we start polling
 *  — gives the callback path a chance to land first. */
const SETTLE_GRACE = sql`interval '5 minutes'`;
/** CCAvenue auto-cancels after 5 days; older rows aren't worth polling. */
const MAX_AGE = sql`interval '5 days'`;

export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  if (!isCCAvenueConfigured()) {
    return NextResponse.json(
      { ok: true, skipped: "ccavenue_not_configured" },
      { status: 200 }
    );
  }

  // Eligible rows: payment still pending, never finalised, created long
  // enough ago to let the callback land but not so long that CCAvenue's
  // auto-cancel will hide them, and either never polled or last polled
  // before the cooldown window.
  const rows = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      gatewayTrackingId: payments.gatewayTrackingId,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        // Pending rows that never finalised, OR recently-failed rows that
        // carry a CCAvenue tracking id. The latter covers a retry whose
        // success callback we missed: re-polling lets finalizeOrderPayment
        // heal `failed` → `paid` server-side. Paid/refunded are terminal and
        // excluded. (The MAX_AGE window keeps this to recent failures; the
        // historical backlog is handled by a one-off remediation script.)
        or(
          and(
            eq(payments.status, "pending"),
            eq(payments.paymentFinalized, false),
          ),
          and(
            eq(payments.status, "failed"),
            isNotNull(payments.gatewayTrackingId),
          ),
        ),
        lt(payments.createdAt, sql`now() - ${SETTLE_GRACE}`),
        sql`${payments.createdAt} > now() - ${MAX_AGE}`,
        or(
          isNull(payments.lastStatusPollAt),
          lt(payments.lastStatusPollAt, sql`now() - ${PER_ORDER_COOLDOWN}`)
        )
      )
    )
    // Oldest-untouched first so a backlog drains fairly instead of the
    // scan re-hitting the same heap pages run after run. coalesce() keeps
    // never-polled rows ahead of recently-polled ones.
    .orderBy(asc(sql`coalesce(${payments.lastStatusPollAt}, ${payments.createdAt})`))
    .limit(BATCH_LIMIT);

  let finalizedPaid = 0;
  let finalizedFailed = 0;
  let stillPending = 0;
  let errors = 0;

  for (const row of rows) {
    // Mark the attempt first so a failed call still respects the cooldown.
    await db
      .update(payments)
      .set({ lastStatusPollAt: new Date() })
      .where(eq(payments.orderId, row.orderId));

    try {
      // CCAvenue knows this transaction by the order_id we sent at
      // session-init, which is orders.id (UUID) — see buildRedirectPayload.
      // Sending orderNumber here returns "No Record Found".
      const normalized = await fetchCCAvenueOrderStatus({
        referenceNo: row.gatewayTrackingId ?? null,
        orderNo: row.orderId,
      });
      // Persist the raw CCAvenue status so the admin orders list can
      // show "Initiated" / "Awaited" / "No Record Found" / etc. instead
      // of the stale local "placed" label while the order is pending.
      await db
        .update(payments)
        .set({
          gatewayResponseMessage: `CCAvenue ${new Date().toISOString()}: status=${normalized.rawStatus}`,
        })
        .where(eq(payments.orderId, row.orderId));
      const result = await finalizeOrderPayment({
        orderId: row.orderId,
        source: "cron-reconcile",
        normalized,
      });
      if (result.kind === "marked-paid") finalizedPaid++;
      else if (result.kind === "marked-failed") finalizedFailed++;
      else stillPending++;
    } catch (e) {
      errors++;
      console.error(
        `[ccavenue-reconcile] order=${row.orderId} status-poll failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  return NextResponse.json({
    ok: true,
    checked: rows.length,
    finalizedPaid,
    finalizedFailed,
    stillPending,
    errors,
  });
}
