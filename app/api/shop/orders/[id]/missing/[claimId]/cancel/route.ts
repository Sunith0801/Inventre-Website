import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { missingItemClaims, webhookDeliveries } from "@/db/schema";
import { getCurrentParent } from "@/server/session";
import { isExchangeTester } from "@/server/exchange-gate";
import { applyMissingCancellation } from "@/server/missing";
import { isCancellableRequestStatus } from "@/lib/exchange-shared";
import { postErpEvent } from "@/server/erp-bridge";

/**
 * Customer self-cancellation of a MISSING-ITEM claim. Mirror of the exchange
 * cancel route — see that file for the full flow rationale.
 *
 *   POST /api/shop/orders/[id]/missing/[claimId]/cancel
 *   Body: { "reason": "<1-500 chars>" }
 */

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; claimId: string }> },
) {
  const me = await getCurrentParent();
  if (!me) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!isExchangeTester(me.phone)) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  const { claimId } = await params;
  if (!UUID_RE.test(claimId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

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

  const [row] = await db
    .select({
      id: missingItemClaims.id,
      status: missingItemClaims.status,
      claimNumber: missingItemClaims.claimNumber,
      replacementArrivedAt: missingItemClaims.replacementArrivedAt,
    })
    .from(missingItemClaims)
    .where(and(eq(missingItemClaims.id, claimId), eq(missingItemClaims.parentId, me.id)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  if (row.status === "rejected") {
    return NextResponse.json({ status: "cancelled" });
  }

  if (!isCancellableRequestStatus(row.status, !!row.replacementArrivedAt)) {
    return NextResponse.json(
      { error: "This request can no longer be cancelled.", refresh: true },
      { status: 409 },
    );
  }

  const erp = await postErpEvent("missing.cancel_requested", `missing:${row.id}`, {
    claim: {
      id: row.id,
      claim_number: row.claimNumber ?? undefined,
      reason,
    },
  });

  if (erp.ok) {
    await applyMissingCancellation(row.id, reason);
    return NextResponse.json({ status: "cancelled" });
  }

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

  console.error(
    `[missing.cancel] ERP rejected cancel for ${row.id}: HTTP ${erp.status} ${erp.body?.slice(0, 200)}`,
  );
  return NextResponse.json(
    { error: "We couldn't cancel this right now. Please try again in a moment or contact support." },
    { status: 502 },
  );
}
