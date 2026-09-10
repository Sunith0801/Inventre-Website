import { NextResponse } from "next/server";
import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { returns } from "@/db/schema";
import { getErpConfig } from "@/server/erp-config";
import {
  isExchangeStatus,
  transitionExchangeStatus,
  applyExchangeCancellation,
  isCancelledReason,
  type ExchangeStatus,
} from "@/server/exchange";

/**
 * Inbound webhook from audit.inventre.in for exchange-request status
 * flips (Approved / Rejected / Delivered).
 *
 *   POST /api/erp/webhooks/exchange
 *   Headers: X-ERP-Signature: sha256=<hex>   (HMAC over raw body)
 *   Body: {
 *     "event_type": "exchange.approved" | "exchange.rejected" | "exchange.received",
 *     "exchange": {
 *        "id": "<inventre returns.id>"   // preferred
 *        // OR:
 *        "return_number": "RTN-2026-NNNNN",
 *        "status": "approved" | "rejected" | "received"
 *     }
 *   }
 *
 * Processing is inline (not queued) because the parent's order page is
 * polling for status — the round-trip should land in seconds. The
 * status transition is monotonic; a late or duplicate delivery for an
 * already-completed exchange responds 409 (which audit can ignore).
 *
 * Auth: reuses the existing `ERP_WEBHOOK_SECRET` (same secret the
 * outbound bridge signs with, since the channel is symmetrical).
 */

export const dynamic = "force-dynamic";

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface Envelope {
  event_type?: string;
  exchange?: {
    id?: string;
    return_number?: string;
    status?: string;
    // Sent by audit when the transition is `rejected`. Captured in
    // customer-care's reject form and shown verbatim to the customer
    // on /shop/orders/[id]/exchange/[returnId]. Ignored for other
    // transitions.
    rejection_reason?: string;
    // Sent alongside `rejection_reason` when the rejection is a duplicate:
    // the other request(s) already covering this item and who raised each
    // ("team" = our support on the customer's behalf, "customer" = the
    // parent). Persisted to returns.duplicate_of so the customer's status
    // page can point them at the existing RTN. Absent/empty = not a dup.
    duplicate_of?: {
      return_number?: string;
      status?: string | null;
      raised_by?: "team" | "customer" | null;
    }[];
    // Sent with the `exchange.replacement_arrived` sub-state event when
    // the warehouse → school dispatch leg lands. Doesn't change the
    // exchange status; just stamps the timestamp so the customer page
    // can render an intermediate "arrived at school" state between
    // `approved` and the final pickup.
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
  const ex = env.exchange ?? {};

  // Create event: customer-care raised this exchange manually in audit
  // (no inventre row exists yet). Build one so the parent sees it on their
  // order page. Returns the new returns.id so audit can pin it as ecom_id
  // and route subsequent status flips through the normal channel.
  if (env.event_type === "exchange.created") {
    const { createExchangeFromAudit } = await import("@/server/audit-inbound");
    const res = await createExchangeFromAudit(
      ex as import("@/server/audit-inbound").AuditExchangeCreate
    );
    return NextResponse.json(res.body, { status: res.status });
  }

  // Sub-state event: warehouse → school dispatch landed. Stamp
  // `replacement_arrived_at` on the matching returns row without
  // changing its status, so the customer page can render an
  // intermediate "your replacement is at school" message without
  // breaking the monotonic status machine.
  if (env.event_type === "exchange.replacement_arrived") {
    const arrivedAt = ex.replacement_arrived_at
      ? new Date(ex.replacement_arrived_at)
      : new Date();
    let updated = 0;
    if (ex.id && /^[0-9a-f-]{36}$/i.test(ex.id)) {
      const res = await db
        .update(returns)
        .set({ replacementArrivedAt: arrivedAt, updatedAt: new Date() })
        .where(and(eq(returns.id, ex.id), eq(returns.kind, "exchange")));
      updated = res.rowCount ?? 0;
    } else if (ex.return_number) {
      const res = await db
        .update(returns)
        .set({ replacementArrivedAt: arrivedAt, updatedAt: new Date() })
        .where(
          and(eq(returns.returnNumber, ex.return_number), eq(returns.kind, "exchange"))
        );
      updated = res.rowCount ?? 0;
    }
    if (updated === 0) {
      return NextResponse.json({ error: "Exchange not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, sub_state: "replacement_arrived" });
  }

  // Audit uses its own status vocabulary for some states; normalize the
  // ones that differ from inventre's exchange enum before validating.
  // Audit's terminal "exchange_completed" is our "received" (completed).
  const AUDIT_EXCHANGE_ALIASES: Record<string, ExchangeStatus> = {
    exchange_completed: "received",
  };
  const status =
    (ex.status && AUDIT_EXCHANGE_ALIASES[ex.status]) ?? ex.status;
  if (!isExchangeStatus(status)) {
    return NextResponse.json(
      { error: `Unknown or unsupported status: ${ex.status ?? "(missing)"}` },
      { status: 400 }
    );
  }
  // `requested` is owned by the storefront — it's the initial state when
  // the parent submits. The webhook should never push it back.
  if (status === "requested") {
    return NextResponse.json(
      { error: "Webhook cannot set status to 'requested'" },
      { status: 400 }
    );
  }

  // Resolve the local row. Prefer the canonical UUID; fall back to the
  // returnNumber so audit can address rows by their human-readable code
  // when their DocType isn't tracking our UUID yet.
  let localId: string | null = null;
  if (ex.id && /^[0-9a-f-]{36}$/i.test(ex.id)) {
    localId = ex.id;
  } else if (ex.return_number) {
    const [row] = await db
      .select({ id: returns.id })
      .from(returns)
      .where(eq(returns.returnNumber, ex.return_number))
      .limit(1);
    localId = row?.id ?? null;
  }
  if (!localId) {
    return NextResponse.json(
      { error: "Could not resolve exchange (provide exchange.id or exchange.return_number)" },
      { status: 404 }
    );
  }

  // Cancellation confirmation: a `rejected` whose reason begins "Cancelled — "
  // is a customer/staff cancellation, not a decline. Route it through the
  // cancellation path so it can land from `approved` too (the monotonic
  // machine forbids approved→rejected) and stays idempotent with the
  // storefront's optimistic write. See lib/exchange-shared.ts §"Customer
  // self-cancellation".
  if (status === "rejected" && isCancelledReason(ex.rejection_reason)) {
    const res = await applyExchangeCancellation(localId, ex.rejection_reason ?? "");
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    return NextResponse.json({ ok: true, id: localId, cancelled: true });
  }

  // Normalize duplicate_of to the persisted shape; only entries with a
  // real return_number survive. Left null when audit didn't send one.
  const duplicateOf =
    Array.isArray(ex.duplicate_of) && ex.duplicate_of.length > 0
      ? ex.duplicate_of
          .filter(
            (d): d is { return_number: string; status?: string | null; raised_by?: "team" | "customer" | null } =>
              !!d && typeof d.return_number === "string" && d.return_number.trim() !== ""
          )
          .map((d) => ({
            return_number: d.return_number.trim(),
            status: typeof d.status === "string" ? d.status : null,
            raised_by: d.raised_by === "team" || d.raised_by === "customer" ? d.raised_by : null,
          }))
      : null;

  const result = await transitionExchangeStatus(
    localId,
    status as ExchangeStatus,
    ex.rejection_reason ?? null,
    duplicateOf && duplicateOf.length > 0 ? duplicateOf : null
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  return NextResponse.json({
    ok: true,
    id: localId,
    from: result.from,
    to: result.to,
  });
}
