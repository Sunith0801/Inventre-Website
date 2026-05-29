/**
 * Drain queued ERP webhook events.
 *
 * Paired with `/api/erp/webhooks` — the receiver writes raw events into
 * `erp_webhook_events` and returns 200 immediately. This cron processes
 * them out-of-band so the receiver path is not on the critical path of
 * any customer request, and a burst of ERP webhooks can't saturate the
 * DB pool inline.
 *
 *   GET /api/cron/erp-webhook-drain
 *   Auth: Authorization: Bearer <CRON_TOKEN>
 *
 * Cadence: invoked every 15s by /etc/cron.d/inventre-erp (four entries
 * with 0/15/30/45s sleep offsets).
 *
 * Concurrency: a single drain run pulls a chunk with `FOR UPDATE SKIP
 * LOCKED` so two crons firing nearly simultaneously partition the
 * outstanding events instead of fighting over them. Within a run,
 * events are processed sequentially — bursts can already cost ~50ms per
 * event in mirror queries, and we'd rather keep the DB pool free for
 * customer requests than parallelise here.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
// Cron routes use the isolated `dbCron` pool (max=8) so a tight drain
// loop can't starve the customer request pool (`db`, max=30).
import { dbCron as db } from "@/db/client";
import { erpInboundDisabledResponse } from "@/lib/erp-inbound-guard";
import {
  dispatchWebhookEvents,
  type WebhookEnvelope,
} from "@/lib/erp-webhook-dispatch";

export const dynamic = "force-dynamic";

const CHUNK = 50;

type Row = {
  event_id: string;
  event_type: string;
  resource_name: string | null;
  payload: unknown;
};

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res)
    ? res
    : ((res as { rows?: unknown[] }).rows ?? [])) as T[];
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_TOKEN ?? ""}`;
  if (!process.env.CRON_TOKEN || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ERP inbound gated since 2026-05-28 (admin panel is canonical).
  const off = erpInboundDisabledResponse();
  if (off) return off;

  let processed = 0;
  let errored = 0;

  // FOR UPDATE SKIP LOCKED is the standard work-queue pattern: each
  // running drain claims a non-overlapping slice in a single statement.
  // CTE wraps the SELECT + UPDATE so we atomically mark the rows as
  // 'processing' before releasing the locks (otherwise after the
  // transaction commits, another drain could pick the same rows).
  const claimed = rowsOf<Row>(
    await db.execute(sql`
      WITH picked AS (
        SELECT event_id
          FROM erp_webhook_events
         WHERE processing_status = 'received'
         ORDER BY received_at
         LIMIT ${CHUNK}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE erp_webhook_events e
         SET processing_status = 'processing'
        FROM picked p
       WHERE e.event_id = p.event_id
       RETURNING e.event_id, e.event_type, e.resource_name, e.payload
    `)
  );

  // Batch dispatch: dispatchWebhookEvents dedupes deriveStatusForErpOrderName
  // across the chunk so 10 shipment events for the same order do 1 derive
  // (was 10). Result map keys per event_id, value = error string or null.
  const events: WebhookEnvelope[] = claimed.map((row) => ({
    event_id: row.event_id,
    event_type: row.event_type,
    resource_name: row.resource_name,
    payload: row.payload,
  }));
  const results = await dispatchWebhookEvents(events);

  // Mark each row's outcome. Batch the updates into a single statement
  // per status for fewer round-trips when the chunk is large.
  const okIds: string[] = [];
  const errPairs: { id: string; msg: string }[] = [];
  for (const env of events) {
    const err = results.get(env.event_id);
    if (err) {
      errored++;
      errPairs.push({ id: env.event_id, msg: err });
      console.warn(
        `[erp-webhook-drain] dispatch failed event=${env.event_type} id=${env.event_id}: ${err}`
      );
    } else {
      processed++;
      okIds.push(env.event_id);
    }
  }
  if (okIds.length > 0) {
    await db
      .execute(sql`
        UPDATE erp_webhook_events
           SET processed_at = now(),
               processing_status = 'processed',
               processing_error = NULL
         WHERE event_id = ANY(${okIds})
      `)
      .catch(() => {});
  }
  for (const { id, msg } of errPairs) {
    await db
      .execute(sql`
        UPDATE erp_webhook_events
           SET processed_at = now(),
               processing_status = 'errored',
               processing_error = ${msg}
         WHERE event_id = ${id}
      `)
      .catch(() => {});
  }

  const dur = Date.now() - startedAt;
  if (claimed.length > 0 || errored > 0) {
    console.log(
      `[erp-webhook-drain] processed=${processed} errored=${errored} claimed=${claimed.length} dur=${dur}ms`
    );
  }
  return NextResponse.json({
    ok: true,
    claimed: claimed.length,
    processed,
    errored,
    durationMs: dur,
  });
}
