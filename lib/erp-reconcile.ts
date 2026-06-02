import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Backstop for the audit-sync producer fan-out.
 *
 * Every code path that flips an order to paid+confirmed is supposed to
 * call `enqueueOrderEvent(orderId, "order.created")` so the drain worker
 * can push it to audit.inventre.in. History (the 405-order leak between
 * 2026-05-26 and 2026-06-02) proves we drift: new producers get added,
 * existing branches grow siblings, and the enqueue call gets missed.
 *
 * This function re-enqueues any paid+confirmed order older than the
 * grace window that is not already on the queue or in the DLQ and has
 * no `erp_so_name` set. Idempotent: safe to run on a cron — already
 * enqueued / already-synced orders are excluded.
 */
export interface ReconcileResult {
  candidates: number;
  enqueued: number;
}

export async function reconcileMissingAuditEvents(): Promise<ReconcileResult> {
  // Grace window: don't fight the CCAvenue 180s enqueue buffer or the
  // 30s drain cadence. 10 min is comfortably past both.
  const result = await db.execute(sql`
    WITH ins AS (
      INSERT INTO erp_outbound_queue (order_id, event_type, scheduled_for)
      SELECT o.id, 'order.created', now()
        FROM orders o
       WHERE o.payment_status = 'paid'
         AND o.status = 'confirmed'
         AND o.erp_so_name IS NULL
         AND o.created_at < now() - interval '10 minutes'
         AND NOT EXISTS (
           SELECT 1 FROM erp_outbound_queue q
            WHERE q.order_id = o.id
              AND q.status IN ('pending', 'sending', 'sent')
         )
         AND NOT EXISTS (
           SELECT 1 FROM erp_outbound_dlq d WHERE d.order_id = o.id
         )
      RETURNING 1
    )
    SELECT COUNT(*)::int AS enqueued FROM ins;
  `);
  const enqueued = Number(
    (result as unknown as [{ enqueued: number }])[0]?.enqueued ?? 0
  );
  return { candidates: enqueued, enqueued };
}
