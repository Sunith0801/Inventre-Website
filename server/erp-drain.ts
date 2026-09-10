import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getErpConfig, isErpBridgeConfigured } from "@/server/erp-config";
import {
  buildErpOrderPayload,
  postErpEvent,
  type ErpEventType,
} from "@/server/erp-bridge";

/**
 * Buffered-outbox drainer.
 *
 * Each tick:
 *   1. Recover rows stuck in `sending` longer than stuckSendingSeconds
 *      (left there by a crashed previous tick).
 *   2. Claim up to `drainChunkSize` ready rows by switching their status
 *      from 'pending' → 'sending' inside a single transaction. The claim
 *      uses FOR UPDATE SKIP LOCKED so two concurrent workers never grab
 *      the same row.
 *   3. For each claimed row, build the envelope from live DB state and
 *      POST it to ERP via the existing postErpEvent path (which logs to
 *      webhook_deliveries). Concurrency bounded by drainConcurrency.
 *   4. Mark the row 'sent' on 2xx; on failure, increment attempts and
 *      either return to 'pending' (transient) or 'failed' (terminal).
 *
 * Per-row try/catch isolation means one bad row can't poison the chunk.
 * Bounded chunks mean a stampede after a 1-hour outage processes in
 * waves the operator can observe.
 */

const TERMINAL_STATUSES = ["sent", "failed", "cancelled"] as const;

/**
 * Phase 4 — exponential backoff between retries.
 *
 * On a transient failure, the row's `scheduled_for` is pushed out by
 * 2^attempts × 30s (capped at 1 hour). That way a flaky ERP gets one
 * fast retry, then increasingly spaced-out retries up to the per-row
 * attempt cap. The drainer's claim query already filters on
 * `scheduled_for <= now()`, so backoff is enforced for free.
 */
function nextBackoffSeconds(attempts: number): number {
  const base = 30; // seconds
  const cap = 3600; // 1 hour
  const exp = Math.min(attempts, 7); // 2^7 = 128 × 30s = 3840s, capped
  return Math.min(base * Math.pow(2, exp), cap);
}

export interface DrainResult {
  recovered: number;
  claimed: number;
  sent: number;
  failed: number;
  errored: number;
  skipped: boolean;
  reason?: string;
}

type ClaimedRow = {
  id: string;
  order_id: string;
  event_type: ErpEventType;
  attempts: number;
};

export async function drainOutboundQueue(): Promise<DrainResult> {
  const cfg = getErpConfig();
  if (!isErpBridgeConfigured(cfg)) {
    return {
      recovered: 0,
      claimed: 0,
      sent: 0,
      failed: 0,
      errored: 0,
      skipped: true,
      reason: `bridge not configured (target=${cfg.target})`,
    };
  }

  // 1. Recover stuck 'sending' rows (previous tick crashed mid-flight).
  const recovered = await db.execute(sql`
    UPDATE erp_outbound_queue
       SET status = 'pending',
           last_error = COALESCE(last_error, '') || ' [recovered from stuck sending]'
     WHERE status = 'sending'
       AND last_attempt_at < now() - (${cfg.stuckSendingSeconds} * interval '1 second')
  `);
  const recoveredCount = Number(
    (recovered as unknown as { count?: number }).count ?? 0
  );

  // 2. Claim a bounded chunk.
  const claimed = await db.execute(sql`
    WITH ready AS (
      SELECT id
        FROM erp_outbound_queue
       WHERE status = 'pending'
         AND scheduled_for <= now()
         AND attempts < ${cfg.drainMaxAttempts}
       ORDER BY enqueued_at ASC
       LIMIT ${cfg.drainChunkSize}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE erp_outbound_queue q
       SET status = 'sending',
           last_attempt_at = now(),
           attempts = q.attempts + 1
      FROM ready
     WHERE q.id = ready.id
     RETURNING q.id, q.order_id, q.event_type, q.attempts
  `);

  const raw = claimed as unknown as ClaimedRow[] | { rows?: ClaimedRow[] };
  const rows: ClaimedRow[] = Array.isArray(raw) ? raw : (raw.rows ?? []);

  if (rows.length === 0) {
    return {
      recovered: recoveredCount,
      claimed: 0,
      sent: 0,
      failed: 0,
      errored: 0,
      skipped: false,
    };
  }

  // 3. Bounded-concurrency dispatch.
  let sent = 0;
  let failed = 0;
  let errored = 0;
  const concurrency = Math.max(1, cfg.drainConcurrency);

  // Process in waves of `concurrency`. Simpler than p-limit and avoids
  // pulling in a dep.
  for (let i = 0; i < rows.length; i += concurrency) {
    const wave = rows.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      wave.map((r) => dispatchRow(r, cfg.drainMaxAttempts))
    );
    for (const r of results) {
      if (r.status === "rejected") {
        errored++;
      } else if (r.value === "sent") {
        sent++;
      } else {
        failed++;
      }
    }
  }

  return {
    recovered: recoveredCount,
    claimed: rows.length,
    sent,
    failed,
    errored,
    skipped: false,
  };
}

async function dispatchRow(
  row: ClaimedRow,
  maxAttempts: number
): Promise<"sent" | "failed"> {
  try {
    const payload = await buildErpOrderPayload(row.order_id);
    if (!payload) {
      // Order vanished (cascade-deleted between enqueue and drain).
      // Mark cancelled — there's nothing left to push.
      await db.execute(sql`
        UPDATE erp_outbound_queue
           SET status = 'cancelled',
               last_error = 'order not found at drain time'
         WHERE id = ${row.id}
      `);
      await moveToDlq(row.id, "order not found at drain time", null);
      return "failed";
    }
    const result = await postErpEvent(
      row.event_type,
      `order:${row.order_id}`,
      payload
    );
    if (result.ok) {
      await db.execute(sql`
        UPDATE erp_outbound_queue
           SET status = 'sent',
               delivery_id = ${result.deliveryId || null},
               last_error = NULL
         WHERE id = ${row.id}
      `);
      if (result.erp_name) {
        // Inventre is the source of truth for `order_number` — the
        // customer-facing ID, allocated at checkout and immutable. ERP
        // honors that ID and echoes it back as `erp_name`. We record it
        // on `erp_so_name` purely as a "synced to ERP" marker so the
        // admin UI can show the sync state.
        await db.execute(sql`
          UPDATE orders
             SET erp_so_name = ${result.erp_name}
           WHERE id = ${row.order_id}
             AND (erp_so_name IS NULL OR erp_so_name <> ${result.erp_name})
        `);
      }
      return "sent";
    }
    // Non-2xx — return to pending with exponential backoff unless
    // this attempt was the last (then move to DLQ).
    const terminal = row.attempts >= maxAttempts;
    const errMsg = `HTTP ${result.status}: ${result.body.slice(0, 500)}`;
    const backoff = nextBackoffSeconds(row.attempts);
    await db.execute(sql`
      UPDATE erp_outbound_queue
         SET status = ${terminal ? "failed" : "pending"},
             last_error = ${errMsg},
             delivery_id = ${result.deliveryId || null},
             scheduled_for = CASE WHEN ${terminal}
                                  THEN scheduled_for
                                  ELSE now() + (${backoff} * interval '1 second')
                              END
       WHERE id = ${row.id}
    `);
    if (terminal) {
      await moveToDlq(row.id, errMsg, await safePayloadJson(row.order_id));
    }
    return "failed";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const terminal = row.attempts >= maxAttempts;
    const backoff = nextBackoffSeconds(row.attempts);
    await db
      .execute(sql`
        UPDATE erp_outbound_queue
           SET status = ${terminal ? "failed" : "pending"},
               last_error = ${msg.slice(0, 500)},
               scheduled_for = CASE WHEN ${terminal}
                                    THEN scheduled_for
                                    ELSE now() + (${backoff} * interval '1 second')
                                END
         WHERE id = ${row.id}
      `)
      .catch(() => {});
    if (terminal) {
      await moveToDlq(row.id, msg.slice(0, 500), await safePayloadJson(row.order_id));
    }
    return "failed";
  }
}

async function moveToDlq(
  queueId: string,
  reason: string,
  payload: unknown
): Promise<void> {
  await db
    .execute(sql`
      INSERT INTO erp_outbound_dlq (
        id, order_id, event_type, attempts, enqueued_at,
        last_attempt_at, last_error, payload
      )
      SELECT id, order_id, event_type, attempts, enqueued_at,
             last_attempt_at, ${reason},
             ${payload ? JSON.stringify(payload) : null}::jsonb
        FROM erp_outbound_queue
       WHERE id = ${queueId}
      ON CONFLICT (id) DO UPDATE SET
        last_error       = EXCLUDED.last_error,
        dead_lettered_at = now()
    `)
    .catch((e) => {
      console.warn(
        "[erp-drain] DLQ insert failed:",
        e instanceof Error ? e.message.slice(0, 200) : e
      );
    });
}

async function safePayloadJson(orderId: string): Promise<unknown | null> {
  try {
    return await buildErpOrderPayload(orderId);
  } catch {
    return null;
  }
}

/** Counts for the admin dashboard. */
export async function getQueueCounts(): Promise<{
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
  dlq: number;
}> {
  const result = await db.execute(sql`
    SELECT status, COUNT(*)::int AS n
      FROM erp_outbound_queue
     GROUP BY status
  `);
  type Row = { status: string; n: number };
  const raw = result as unknown as Row[] | { rows?: Row[] };
  const rs: Row[] = Array.isArray(raw) ? raw : (raw.rows ?? []);
  const out = { pending: 0, sending: 0, sent: 0, failed: 0, cancelled: 0, dlq: 0 };
  for (const r of rs) {
    if (r.status in out) (out as Record<string, number>)[r.status] = r.n;
  }
  // DLQ is a separate table — query and fold into the same payload so
  // the admin UI can show "active queue + dead letters" at a glance.
  const dlq: any = await db
    .execute(sql`SELECT COUNT(*)::int AS n FROM erp_outbound_dlq`)
    .catch(() => null);
  if (dlq) {
    const drows = (dlq.rows ?? dlq) as Array<{ n: number }>;
    out.dlq = Number(drows?.[0]?.n ?? 0);
  }
  return out;
}

export const _terminalStatuses = TERMINAL_STATUSES;
