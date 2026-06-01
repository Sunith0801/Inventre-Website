import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, inArray, sql, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, payments } from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import { fetchCCAvenueOrderStatus, isCCAvenueConfigured } from "@/lib/ccavenue";

/**
 * Bulk-refresh CCAvenue status for N selected orders in one HTTP round-trip
 * from the client. Calls CCAvenue's `orderStatusTracker` API in parallel
 * with a concurrency cap so a 50-order page-batch finishes in seconds
 * instead of seconds-per-row.
 *
 *   POST { orderNumbers: ["SAL-ORD-…", "SAL-ORD-…", …] }
 *   → { results: [
 *       { orderNumber, ok: true,  status, trackingId, paymentDate, paidAmount },
 *       { orderNumber, ok: false, error: "…" }, …
 *     ], summary: { total, ok, withTracking, errored } }
 *
 * Concurrency = 10 — CCAvenue's Status API handles parallel calls without
 * complaint at this rate. Each call has its own 8 s timeout inside
 * `fetchCCAvenueOrderStatus`, so the worst-case wall time for the batch is
 * `ceil(N / 10) * 8 s`. For 50 orders that's ≤ 40 s, usually ~5–10 s once
 * cache is warm.
 */
const Body = z.object({
  orderNumbers: z.array(z.string().min(1)).min(1).max(500),
});

type ApiResult =
  | {
      orderNumber: string;
      ok: true;
      status: string;
      rawStatus: string;
      trackingId: string | null;
      paymentDate: string | null;
      paidAmount: string | null;
    }
  | { orderNumber: string; ok: false; error: string };

/** Drains the queue with `limit` workers in flight at a time. Returns
 *  the results in the same index order as the input. */
async function withConcurrency<T, U>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<U>
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let next = 0;
  const inFlight: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    inFlight.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx], idx);
        }
      })()
    );
  }
  await Promise.all(inFlight);
  return results;
}

export async function POST(req: Request) {
  const guard = await requirePermission("orders.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseJson(req, Body);
  if (parsed instanceof NextResponse) return parsed;

  if (!isCCAvenueConfigured()) {
    return NextResponse.json(
      { error: "CCAvenue env vars missing — set CCAVENUE_* in .env.local" },
      { status: 503 }
    );
  }

  // One DB read for all selected orders + their payment row. Joining
  // here means the per-order worker doesn't issue its own SELECT, which
  // matters when we're firing 50 of them in parallel.
  //
  // IMPORTANT: order has-many payments (retry attempts are common after
  // failures), so the join can return N rows per order. The Orders
  // dashboard's `first_payment` CTE reads the EARLIEST payment per order
  // (DISTINCT ON … ORDER BY created_at ASC). We must patch the same row
  // here, otherwise the refresh writes to a later attempt and the
  // dashboard keeps showing the stale status from the earlier one.
  const joined = await db
    .select({
      orderNumber: orders.orderNumber,
      orderId: orders.id,
      paymentId: payments.id,
      paymentCreatedAt: payments.createdAt,
      gatewayTrackingId: payments.gatewayTrackingId,
      paidAmount: payments.paidAmount,
      paymentMode: payments.paymentMode,
      paymentDate: payments.paymentDate,
    })
    .from(orders)
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(inArray(orders.orderNumber, parsed.orderNumbers))
    .orderBy(asc(orders.orderNumber), asc(payments.createdAt));

  // Collapse to the FIRST payment per order. asc-ordered by createdAt
  // means the first occurrence we see for each orderNumber is the
  // earliest payment.
  const byOrderNo = new Map<string, (typeof joined)[number]>();
  for (const r of joined) {
    if (!byOrderNo.has(r.orderNumber)) byOrderNo.set(r.orderNumber, r);
  }

  // The work — one CCAvenue call per orderNumber, parallel with cap.
  const results = await withConcurrency<string, ApiResult>(
    parsed.orderNumbers,
    10,
    async (orderNumber) => {
      const local = byOrderNo.get(orderNumber);
      if (!local) {
        return { orderNumber, ok: false, error: "order not found locally" };
      }
      try {
        const cca = await fetchCCAvenueOrderStatus({
          orderNo: orderNumber,
          referenceNo: local.gatewayTrackingId ?? null,
        });
        return {
          orderNumber,
          ok: true,
          status: cca.status,
          rawStatus: cca.rawStatus,
          trackingId: cca.trackingId,
          paymentDate: cca.paymentDate,
          paidAmount: cca.paidAmount,
        };
      } catch (e) {
        return {
          orderNumber,
          ok: false,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        };
      }
    }
  );

  // Single DB pass to write back. Build (paymentId, fields) tuples for the
  // rows we actually got new data on, then do one bulk UPDATE per row in a
  // transaction. (Postgres doesn't support multi-row UPDATE in a single
  // statement without UNNEST gymnastics — clean per-row in a tx is fine
  // for 50–500 rows.)
  const writeStartedAt = Date.now();
  await db.transaction(async (tx) => {
    for (const r of results) {
      if (!r.ok) continue;
      const local = byOrderNo.get(r.orderNumber);
      if (!local?.paymentId) continue;
      const patch: Record<string, unknown> = {
        lastStatusPollAt: new Date(),
        gatewayResponseMessage: `CCAvenue bulk-refresh ${new Date().toISOString()}: status=${r.rawStatus}`,
      };
      if (r.trackingId && r.trackingId !== local.gatewayTrackingId) {
        patch.gatewayTrackingId = r.trackingId;
      }
      if (r.paidAmount && r.paidAmount !== local.paidAmount) {
        patch.paidAmount = r.paidAmount;
      }
      if (r.paymentDate && r.paymentDate !== local.paymentDate) {
        patch.paymentDate = r.paymentDate;
      }
      await tx.update(payments).set(patch).where(eq(payments.id, local.paymentId));
    }
  });
  const writeMs = Date.now() - writeStartedAt;

  revalidatePath("/admin/orders");

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    withTracking: results.filter((r): r is Extract<ApiResult, { ok: true }> => r.ok && !!r.trackingId).length,
    errored: results.filter((r) => !r.ok).length,
    writeMs,
  };

  return NextResponse.json({ results, summary });
}
