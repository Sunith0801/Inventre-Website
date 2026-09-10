import { NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { missingItemClaims } from "@/db/schema";
import { getErpConfig } from "@/server/erp-config";
import { isMissingClaimStatus } from "@/server/missing";

/**
 * Inbound webhook from audit.inventre.in for missing-item-claim status
 * flips (Approved / Rejected / ReplacementArrived / Delivered).
 *
 *   POST /api/erp/webhooks/missing
 *   Headers: X-ERP-Signature: sha256=<hex>
 *   Body: {
 *     "event_type": "missing.approved" | "missing.rejected"
 *                  | "missing.replacement_arrived" | "missing.delivered",
 *     "claim": {
 *        "id": "<inventre missing_item_claims.id>",      // canonical
 *        "claim_number": "MIS-2026-NNNNN",                // optional
 *        "status": "approved" | "rejected"
 *                | "received_at_school" | "delivered",
 *        "rejection_reason": "...",                       // on reject
 *        "replacement_arrived_at": "...",                 // on replacement_arrived
 *     }
 *   }
 */

export const dynamic = "force-dynamic";

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface Envelope {
  event_type?: string;
  claim?: {
    id?: string;
    claim_number?: string;
    status?: string;
    rejection_reason?: string;
    replacement_arrived_at?: string;
  };
}

export async function POST(req: Request) {
  const cfg = getErpConfig();
  if (!cfg.webhookSecret) {
    return NextResponse.json({ error: "webhook secret not set" }, { status: 503 });
  }

  const raw = await req.text();
  const sigHeader = req.headers.get("x-erp-signature") ?? "";
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", cfg.webhookSecret).update(raw).digest("hex");
  if (!sigHeader || !timingSafeEqHex(sigHeader, expected)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let env: Envelope;
  try {
    env = JSON.parse(raw) as Envelope;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const cl = env.claim ?? {};

  // Create event: customer-care raised this missing-item claim manually in
  // audit (no inventre row exists yet). Build one so the parent sees it on
  // their order page. Returns the new claim id for audit to pin as ecom_id.
  if (env.event_type === "missing.created") {
    const { createMissingFromAudit } = await import("@/server/audit-inbound");
    const res = await createMissingFromAudit(
      cl as import("@/server/audit-inbound").AuditMissingCreate
    );
    return NextResponse.json(res.body, { status: res.status });
  }

  // Sub-state event: warehouse → school dispatch landed.
  if (env.event_type === "missing.replacement_arrived") {
    const arrivedAt = cl.replacement_arrived_at
      ? new Date(cl.replacement_arrived_at)
      : new Date();
    let updated = 0;
    if (cl.id && /^[0-9a-f-]{36}$/i.test(cl.id)) {
      const res = await db
        .update(missingItemClaims)
        .set({ replacementArrivedAt: arrivedAt, updatedAt: new Date() })
        .where(eq(missingItemClaims.id, cl.id));
      updated = res.rowCount ?? 0;
    } else if (cl.claim_number) {
      const res = await db
        .update(missingItemClaims)
        .set({ replacementArrivedAt: arrivedAt, updatedAt: new Date() })
        .where(eq(missingItemClaims.claimNumber, cl.claim_number));
      updated = res.rowCount ?? 0;
    }
    if (updated === 0) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, sub_state: "replacement_arrived" });
  }

  const status = cl.status;
  if (!isMissingClaimStatus(status)) {
    return NextResponse.json(
      { error: `Unknown or unsupported status: ${status ?? "(missing)"}` },
      { status: 400 }
    );
  }
  if (status === "requested") {
    return NextResponse.json(
      { error: "Webhook cannot set status to 'requested'" },
      { status: 400 }
    );
  }

  // Resolve the local row.
  let localId: string | null = null;
  if (cl.id && /^[0-9a-f-]{36}$/i.test(cl.id)) {
    localId = cl.id;
  } else if (cl.claim_number) {
    const [row] = await db
      .select({ id: missingItemClaims.id })
      .from(missingItemClaims)
      .where(eq(missingItemClaims.claimNumber, cl.claim_number))
      .limit(1);
    localId = row?.id ?? null;
  }
  if (!localId) {
    return NextResponse.json({ error: "Could not resolve claim" }, { status: 404 });
  }

  // Apply the transition. Monotonic — refuses to roll back. Persist
  // the rejection_reason when rejected.
  const patch: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  if (status === "approved") patch.approvedAt = new Date();
  if (status === "delivered") patch.receivedAt = new Date();
  if (status === "rejected" && cl.rejection_reason) {
    patch.rejectionReason = cl.rejection_reason.trim();
    patch.rejectedAt = new Date();
  }

  const res = await db
    .update(missingItemClaims)
    .set(patch)
    .where(eq(missingItemClaims.id, localId));
  if ((res.rowCount ?? 0) === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: localId, status });
}
