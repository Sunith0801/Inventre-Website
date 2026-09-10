import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, payments } from "@/db/schema";
import { parseCallback, normalizeCallbackPayload } from "@/server/ccavenue";
import { finalizeOrderPayment } from "@/server/ccavenue-finalize";

/**
 * CCAvenue posts back form-encoded data with an `encResp` field. We decrypt
 * with the working key, normalise the payload into a `NormalizedGatewayResult`,
 * and hand it to `finalizeOrderPayment` — the shared finaliser used by
 * both this route and the Status-API poller. That helper owns all the
 * "paid" side effects (stock decrement, cart clear, SMS, ERP enqueue)
 * and the idempotency guard.
 *
 * Dual-mode: the same URL handles BOTH (a) the browser-side redirect from
 * the hosted payment page AND (b) the server-side Dynamic Event
 * Notification webhook configured in the CCAvenue dashboard. We pick the
 * response shape from the User-Agent / Accept headers — browsers get a
 * 303 to the order page, webhooks get a 200 JSON ack.
 *
 * Note: CCAvenue does NOT sign the callback separately — the cipher itself
 * is the auth. If the AES decrypt succeeds and the payload references a
 * known order, it's authentic.
 */
function isBrowserRedirect(req: Request): boolean {
  const ua = req.headers.get("user-agent") ?? "";
  const accept = req.headers.get("accept") ?? "";
  if (/Mozilla|Chrome|Safari|Firefox|Edge|Opera/i.test(ua)) return true;
  if (accept.includes("text/html")) return true;
  return false;
}

export async function POST(req: Request) {
  // Inside Docker, `req.url` is http://0.0.0.0:3000/... — useless for
  // building user-facing redirect URLs. Resolution order (all runtime
  // reads — NEXT_PUBLIC_* would be inlined at build time and wedge to
  // whatever host built the bundle):
  //   1. APP_PUBLIC_URL env (preferred — set in .env.deploy per env)
  //   2. X-Forwarded-Host header + X-Forwarded-Proto (nginx in front)
  //   3. NEXT_PUBLIC_APP_URL (last-resort)
  //   4. origin of req.url (container localhost — last fallback)
  function resolvePublicBase(): string {
    const env = process.env.APP_PUBLIC_URL?.replace(/\/+$/, "");
    if (env) return env;
    const host =
      req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    if (host) return `${proto}://${host}`;
    const nextPub = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
    if (nextPub) return nextPub;
    return new URL(req.url).origin;
  }
  const publicBase = resolvePublicBase();

  // CCAvenue uses application/x-www-form-urlencoded
  const body = await req.formData();
  const encResp = String(body.get("encResp") ?? "");
  if (!encResp) {
    return NextResponse.json({ error: "missing encResp" }, { status: 400 });
  }

  let fields: Record<string, string>;
  try {
    fields = parseCallback(encResp);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "decryption failed" },
      { status: 400 }
    );
  }

  const orderId = fields.order_id;
  if (!orderId) {
    return NextResponse.json({ error: "missing order_id" }, { status: 400 });
  }

  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  // Pre-finalize idempotency snapshot — used only to pick the right
  // browser response (success vs failed redirect) when the second call
  // arrives. The actual no-op gating happens inside finalizeOrderPayment.
  const [pmtSnapshot] = await db
    .select({
      status: payments.status,
      paymentFinalized: payments.paymentFinalized,
    })
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .limit(1);

  // Short-circuit ONLY for an order already in a terminal SUCCESS state — a
  // fresh callback can't improve a paid order. A `failed` order is
  // deliberately NOT short-circuited: CCAvenue reuses the same order_id when
  // a parent retries, so the retry's success callback must fall through to
  // finalizeOrderPayment to heal the previously failed+finalized row.
  // (finalize is idempotent — a repeat `failed` callback no-ops there.)
  if (pmtSnapshot?.paymentFinalized && pmtSnapshot.status === "paid") {
    if (isBrowserRedirect(req)) {
      return NextResponse.redirect(
        `${publicBase}/shop/orders/${orderId}?payment=success&placed=1`,
        303
      );
    }
    return NextResponse.json({ ok: true, alreadyFinalized: true });
  }

  const normalized = normalizeCallbackPayload(fields);
  const result = await finalizeOrderPayment({
    orderId,
    source: "callback",
    normalized,
  });

  // Translate the helper's tagged result into the dual-mode response
  // shape CCAvenue (and the parent's browser) expect.
  if (result.kind === "marked-paid") {
    if (isBrowserRedirect(req)) {
      return NextResponse.redirect(
        `${publicBase}/shop/orders/${orderId}?payment=success&placed=1`,
        303
      );
    }
    return NextResponse.json({ ok: true, status: "paid" });
  }

  if (result.kind === "marked-failed") {
    if (isBrowserRedirect(req)) {
      return NextResponse.redirect(
        `${publicBase}/shop/orders/${orderId}?payment=failed`,
        303
      );
    }
    return NextResponse.json({ ok: true, status: "failed" });
  }

  // no-change: either still_pending (CCAvenue claims pending — odd for a
  // callback, but possible during refunded-then-rebilled flows), or
  // unknown_status. Surface the current state without flipping anything.
  if (isBrowserRedirect(req)) {
    return NextResponse.redirect(
      `${publicBase}/shop/orders/${orderId}`,
      303
    );
  }
  return NextResponse.json({ ok: true, status: result.reason });
}
