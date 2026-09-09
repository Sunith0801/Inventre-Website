import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { returns, webhookDeliveries } from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { isExchangeTester } from "@/lib/exchange-gate";
import {
  applyExchangeCancellation,
  isCancellableRequestStatus,
} from "@/lib/exchange";
import { postErpEvent } from "@/lib/erp-bridge";

/**
 * Customer self-cancellation of an EXCHANGE (return) request.
 *
 *   POST /api/shop/orders/[id]/exchange/[returnId]/cancel
 *   Body: { "reason": "<1-500 chars>" }
 *
 * Flow (see lib/exchange-shared.ts §"Customer self-cancellation"):
 *   1. Auth + ownership: a logged-in parent who owns this return, gated by
 *      the same EXCHANGE_TESTER allowlist as the rest of the flow.
 *   2. The signing secret NEVER reaches the browser — the browser calls this
 *      backend, which signs and forwards a `exchange.cancel_requested` event
 *      to the ERP via the existing `postErpEvent` bridge (HMAC-SHA256 over the
 *      exact JSON bytes, X-Ecom-Signature). The ERP performs the real cancel
 *      (voids the packed box, frees stock) and is the FINAL authority on
 *      whether it's too late.
 *   3. On ERP 200 (applied|duplicate) we optimistically flip the local row to
 *      the "Cancelled" state; the ERP's follow-up rejected/"Cancelled —"
 *      webhook then confirms it (idempotent). On 409 the window has closed —
 *      we do NOT retry and tell the client to refresh. On 401/other we surface
 *      a generic error (never leak the secret misconfig to the customer).
 */

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; returnId: string }> },
) {
  const me = await getCurrentParent();
  if (!me) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!isExchangeTester(me.phone)) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  const { returnId } = await params;
  if (!UUID_RE.test(returnId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  // Reason: required, 1–500 chars.
  let reason: string;
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body?.reason !== "string") {
      return NextResponse.json(
        { error: "Please tell us why you're cancelling." },
        { status: 400 },
      );
    }
    reason = body.reason.trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (reason.length < 1 || reason.length > 500) {
    return NextResponse.json(
      { error: "Reason must be between 1 and 500 characters." },
      { status: 400 },
    );
  }

  // Ownership: the parent must own this exchange row.
  const [row] = await db
    .select({
      id: returns.id,
      status: returns.status,
      kind: returns.kind,
      returnNumber: returns.returnNumber,
      replacementArrivedAt: returns.replacementArrivedAt,
    })
    .from(returns)
    .where(and(eq(returns.id, returnId), eq(returns.parentId, me.id)))
    .limit(1);
  if (!row || row.kind !== "exchange") {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  // Already cancelled/rejected → idempotent success (button will be gone
  // after the client refreshes).
  if (row.status === "rejected") {
    return NextResponse.json({ status: "cancelled" });
  }

  // Client-side cancellability hint. The ERP is the final authority (it may
  // reply 409 even when we think it's still early), but there's no point
  // emitting when we already know the request has moved past cancellation.
  if (
    !isCancellableRequestStatus(row.status, !!row.replacementArrivedAt)
  ) {
    return NextResponse.json(
      { error: "This request can no longer be cancelled.", refresh: true },
      { status: 409 },
    );
  }

  // Sign + forward the cancel event to the ERP. Aggregate MUST match the one
  // used by exchange.requested so the ERP's per-aggregate seq stays ordered;
  // nextSeq() (inside postErpEvent) is globally monotonic so the seq is always
  // strictly greater than the last one used for this exchange.
  const erp = await postErpEvent("exchange.cancel_requested", `exchange:${row.id}`, {
    exchange: {
      id: row.id,
      return_number: row.returnNumber ?? undefined,
      reason,
    },
  });

  // Success: ERP accepted (200 applied|duplicate). Optimistically show
  // "Cancelled"; the follow-up webhook confirms it (idempotent).
  if (erp.ok) {
    await applyExchangeCancellation(row.id, reason);
    return NextResponse.json({ status: "cancelled" });
  }

  // 409: too late (already packed / dispatched) OR stale seq. Do NOT retry —
  // clear the retry marker the bridge stamped, and tell the client to refresh.
  if (erp.status === 409) {
    if (erp.deliveryId) {
      await db
        .update(webhookDeliveries)
        .set({ nextRetryAt: null })
        .where(eq(webhookDeliveries.id, erp.deliveryId))
        .catch(() => {});
    }
    return NextResponse.json(
      { error: "This request can no longer be cancelled.", refresh: true },
      { status: 409 },
    );
  }

  // 401 = signature/secret misconfig; 0/5xx = ERP unreachable. Log server-side
  // (postErpEvent already recorded the delivery + error) and show a generic
  // message — never surface the secret problem to the customer.
  console.error(
    `[exchange.cancel] ERP rejected cancel for ${row.id}: HTTP ${erp.status} ${erp.body?.slice(0, 200)}`,
  );
  return NextResponse.json(
    { error: "We couldn't cancel this right now. Please try again in a moment or contact support." },
    { status: 502 },
  );
}
