import { NextResponse } from "next/server";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getErpConfig } from "@/lib/erp-config";
import { erpInboundDisabledResponse } from "@/lib/erp-inbound-guard";

/**
 * Inbound webhook receiver.
 *
 * Endpoint: POST /api/erp/webhooks
 *
 *   {
 *     "event_id":   "<uuid, unique per delivery>",
 *     "event_type": "order.updated | shipment.dispatched | ...",
 *     "resource_name": "<SAL-ORD-... or CUST-... etc.>",
 *     "payload":    { ... }
 *   }
 *
 * Auth: `X-ERP-Signature: sha256=<hex>` over the raw JSON body, keyed
 * by `<TARGET>_ERP_WEBHOOK_SECRET`.
 *
 * Backpressure model (rewritten 2026-05-26):
 *   The receiver writes one row into `erp_webhook_events` and returns
 *   200 immediately — milliseconds, single DB statement. The actual
 *   mirror upsert + status derive happens out-of-band in
 *   /api/cron/erp-webhook-drain, which pulls events FOR UPDATE SKIP
 *   LOCKED with bounded concurrency. Before this split, a burst of 10+
 *   shipment webhooks from staging ERP would saturate the app's DB
 *   pool inline (~2s per event × N parallel = 30+ second customer
 *   page loads).
 *
 * Idempotency: insert is ON CONFLICT (event_id) DO NOTHING, so duplicate
 * deliveries from a misbehaving ERP retry loop are a no-op.
 */

export const dynamic = "force-dynamic";

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface WebhookEnvelope {
  event_id: string;
  event_type: string;
  resource_name?: string;
  payload?: unknown;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const cfg = getErpConfig();
  if (!cfg.webhookSecret) {
    return NextResponse.json({ error: "webhook secret not set" }, { status: 503 });
  }

  // Read raw body for HMAC verification — we can't reparse from req.json()
  // after consuming the stream.
  const raw = await req.text();
  const sigHeader = req.headers.get("x-erp-signature") ?? "";
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", cfg.webhookSecret)
      .update(raw)
      .digest("hex");
  if (!sigHeader || !timingSafeEqHex(sigHeader, expected)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  // ERP inbound is gated. Returning 200 with {disabled: true} keeps
  // ERPNext from retrying us into oblivion — they treat 200 as "got it".
  const off = erpInboundDisabledResponse();
  if (off) return off;

  let env: WebhookEnvelope;
  try {
    env = JSON.parse(raw) as WebhookEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!env?.event_id || !env?.event_type) {
    return NextResponse.json(
      { error: "missing event_id or event_type" },
      { status: 400 }
    );
  }

  // Queue the event. The drain cron processes it within ~15 seconds.
  // ON CONFLICT DO NOTHING handles duplicate ERP deliveries; we don't
  // need to RETURNING because the response is identical either way.
  let queueErr: string | null = null;
  try {
    await db.execute(sql`
      INSERT INTO erp_webhook_events (
        event_id, event_type, resource_name, payload
      )
      VALUES (
        ${env.event_id},
        ${env.event_type},
        ${env.resource_name ?? null},
        ${JSON.stringify(env.payload ?? null)}::jsonb
      )
      ON CONFLICT (event_id) DO NOTHING
    `);
  } catch (e) {
    queueErr = e instanceof Error ? e.message.slice(0, 200) : String(e);
    console.error("[erp-webhooks] queue insert failed:", queueErr);
  }

  const dur = Date.now() - startedAt;
  // One-line structured log keeps webhook bursts visible without flooding
  // the container logs. Drain logs the eventual processing outcome.
  console.log(
    `[erp-webhooks] queued event=${env.event_type} id=${env.event_id} resource=${env.resource_name ?? "-"} dur=${dur}ms${queueErr ? ` err=${queueErr.slice(0, 80)}` : ""}`
  );

  if (queueErr) {
    return NextResponse.json(
      { error: "queue write failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, queued: true });
}
