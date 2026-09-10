import "server-only";
import crypto from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  notificationRules,
  webhookEndpoints,
  webhookDeliveries,
} from "@/db/schema";

/**
 * Domain event bus.
 *
 * Call `emit(event, payload)` from anywhere in the app. The bus:
 *   1. Looks up enabled `notification_rules` for the event and dispatches
 *      via the configured channel (email / SMS).
 *   2. Looks up enabled `webhook_endpoints` whose `events[]` contains the
 *      event, queues delivery rows, and POSTs with HMAC-SHA256 signing.
 *
 * Webhook deliveries are non-blocking: queued in `webhook_deliveries` then
 * fired with `setImmediate`. Failed deliveries are scheduled for retry by
 * `processWebhookRetries()` (call from a cron / background worker).
 */

export type DomainEvent =
  | "order.placed"
  | "order.confirmed"
  | "order.cancelled"
  | "order.shipped"
  | "order.delivered"
  | "shipment.created"
  | "invoice.created"
  | "return.requested"
  | "return.refunded"
  | "stock.low";

type EventPayload = Record<string, unknown>;

function sign(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function renderTemplate(
  tpl: string,
  vars: EventPayload,
  context: { event: string; ruleId?: string }
): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const path = String(key).split(".");
    let cur: unknown = vars;
    for (const p of path) {
      if (cur && typeof cur === "object" && p in (cur as object)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        // Save-time validation should catch this; warn loudly if it slips
        // through (e.g. payload shape changed without re-validating rules).
        console.warn(
          `[event-bus] template variable {{${key}}} not present for event=${context.event} rule=${context.ruleId ?? "?"}`
        );
        return "";
      }
    }
    return cur == null ? "" : String(cur);
  });
}

async function dispatchNotification(
  event: DomainEvent,
  payload: EventPayload
): Promise<void> {
  const rules = await db
    .select()
    .from(notificationRules)
    .where(
      and(
        eq(notificationRules.eventType, event),
        eq(notificationRules.enabled, true)
      )
    );

  for (const rule of rules) {
    const ctx = { event, ruleId: rule.id };
    const subject = rule.subject
      ? renderTemplate(rule.subject, payload, ctx)
      : "";
    const body = rule.bodyTemplate
      ? renderTemplate(rule.bodyTemplate, payload, ctx)
      : "";
    try {
      if (rule.channel === "email") {
        const { sendEmail } = await import("@/server/notify/email");
        const to = String(payload.email ?? payload.recipientEmail ?? "");
        if (!to) continue;
        await sendEmail({ to, subject, html: body, text: body });
      } else if (rule.channel === "sms") {
        const { sendSms } = await import("@/server/notify/sms");
        const to = String(payload.phone ?? payload.recipientPhone ?? "");
        if (!to) continue;
        await sendSms({ phone: to, body, templateId: rule.templateId ?? undefined });
      }
    } catch (e) {
      console.error(`[event-bus] notification rule ${rule.id} failed:`, e);
    }
  }
}

async function dispatchWebhooks(
  event: DomainEvent,
  payload: EventPayload
): Promise<void> {
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.enabled, true),
        sql`${event} = ANY(${webhookEndpoints.events})`
      )
    );

  for (const ep of endpoints) {
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        endpointId: ep.id,
        event,
        payload: payload as never,
        status: null,
      })
      .returning();
    setImmediate(() => void deliverWebhook(delivery.id));
  }
}

async function deliverWebhook(deliveryId: number): Promise<void> {
  const [d] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!d) return;
  const [ep] = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, d.endpointId))
    .limit(1);
  if (!ep) return;

  const body = JSON.stringify({
    event: d.event,
    delivery_id: d.id,
    timestamp: new Date().toISOString(),
    payload: d.payload,
  });
  const signature = sign(ep.secret, body);

  try {
    const res = await fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inventre-Event": d.event,
        "X-Inventre-Signature": `sha256=${signature}`,
        "X-Inventre-Delivery": String(d.id),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const respText = await res.text().catch(() => "");
    await db
      .update(webhookDeliveries)
      .set({
        status: res.status,
        responseBody: respText.slice(0, 4000),
        deliveredAt: res.ok ? new Date() : null,
        nextRetryAt: res.ok ? null : nextBackoff(d.attempt),
      })
      .where(eq(webhookDeliveries.id, d.id));
    await db
      .update(webhookEndpoints)
      .set({
        lastDeliveryAt: new Date(),
        lastStatus: res.status,
        lastError: res.ok ? null : `HTTP ${res.status}`,
      })
      .where(eq(webhookEndpoints.id, ep.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    await db
      .update(webhookDeliveries)
      .set({
        status: 0,
        responseBody: msg,
        nextRetryAt: nextBackoff(d.attempt),
      })
      .where(eq(webhookDeliveries.id, d.id));
    await db
      .update(webhookEndpoints)
      .set({ lastDeliveryAt: new Date(), lastStatus: 0, lastError: msg })
      .where(eq(webhookEndpoints.id, ep.id));
  }
}

function nextBackoff(attempt: number): Date | null {
  if (attempt >= 6) return null; // give up after ~ 4 hours
  const minutes = Math.pow(2, attempt) * 2; // 2, 4, 8, 16, 32, 64
  return new Date(Date.now() + minutes * 60_000);
}

/**
 * Top-level emit. Call this from order / shipment / invoice / return code.
 * Always non-blocking — never throws.
 */
export async function emit(
  event: DomainEvent,
  payload: EventPayload
): Promise<void> {
  try {
    await Promise.all([
      dispatchNotification(event, payload),
      dispatchWebhooks(event, payload),
    ]);
  } catch (e) {
    console.error(`[event-bus] emit ${event} failed:`, e);
  }
}

/**
 * Cron entry — pick up failed deliveries due for retry.
 * Wire to your scheduler (e.g. /api/cron/retry-webhooks every minute).
 */
export async function processWebhookRetries(): Promise<{ processed: number }> {
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(
      sql`${webhookDeliveries.nextRetryAt} IS NOT NULL
        AND ${webhookDeliveries.nextRetryAt} <= NOW()
        AND ${webhookDeliveries.deliveredAt} IS NULL
        AND ${webhookDeliveries.attempt} < 6`
    )
    .limit(50);
  for (const d of due) {
    await db
      .update(webhookDeliveries)
      .set({ attempt: d.attempt + 1, nextRetryAt: null })
      .where(eq(webhookDeliveries.id, d.id));
    await deliverWebhook(d.id);
  }
  return { processed: due.length };
}
