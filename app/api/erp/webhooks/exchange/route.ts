import { NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { returns } from "@/db/schema";
import { getErpConfig } from "@/lib/erp-config";
import {
  isExchangeStatus,
  transitionExchangeStatus,
  type ExchangeStatus,
} from "@/lib/exchange";

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
  const status = ex.status;
  if (!isExchangeStatus(status)) {
    return NextResponse.json(
      { error: `Unknown or unsupported status: ${status ?? "(missing)"}` },
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

  const result = await transitionExchangeStatus(localId, status as ExchangeStatus);
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
