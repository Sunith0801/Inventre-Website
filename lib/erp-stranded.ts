import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Stranded-order detector for the audit (ERP) outbound sync.
 *
 * The business invariant: every confirmed + paid order should mirror to
 * audit and end up with a non-empty `orders.erp_so_name`. When ingest
 * fails 5×, its `erp_outbound_queue` row goes to `failed` and is NEVER
 * retried — so a paid order can silently sit unmirrored for days.
 *
 * `alertCooldownHours` prevents the same stuck order from triggering an
 * email every hour. Orders already alerted within the cooldown window are
 * excluded from the report; they'll re-appear once the window expires.
 */

export interface StrandedReport {
  /** Paid+confirmed orders with no erp_so_name, outside the cooldown window. */
  strandedCount: number;
  /** Order IDs to stamp after sending the alert (for cooldown tracking). */
  orderIds: number[];
  /** Up to 50 sample order numbers for the alert body. */
  sample: string[];
  oldest: string | null;
  /** Diagnostic queue counts. */
  queueFailed: number;
  dlq: number;
}

export async function findStrandedOrders(
  graceHours: number,
  alertCooldownHours = 23
): Promise<StrandedReport> {
  const strandedRows = (await db.execute(sql`
    SELECT o.id, o.order_number, o.placed_at
      FROM orders o
     WHERE o.status = 'confirmed'
       AND o.payment_status = 'paid'
       AND (o.erp_so_name IS NULL OR o.erp_so_name = '')
       AND o.placed_at < now() - (${graceHours} * interval '1 hour')
       AND (
         o.erp_stranded_alerted_at IS NULL
         OR o.erp_stranded_alerted_at < now() - (${alertCooldownHours} * interval '1 hour')
       )
     ORDER BY o.placed_at ASC
  `)) as unknown as
    | Array<{ id: number; order_number: string; placed_at: string }>
    | { rows?: Array<{ id: number; order_number: string; placed_at: string }> };
  const rows = Array.isArray(strandedRows)
    ? strandedRows
    : (strandedRows.rows ?? []);

  const failed = (await db.execute(
    sql`SELECT count(*)::int AS n FROM erp_outbound_queue WHERE status = 'failed'`
  )) as unknown as Array<{ n: number }> | { rows?: Array<{ n: number }> };
  const failedRows = Array.isArray(failed) ? failed : (failed.rows ?? []);

  const dlq = (await db
    .execute(sql`SELECT count(*)::int AS n FROM erp_outbound_dlq`)
    .catch(() => null)) as
    | (Array<{ n: number }> | { rows?: Array<{ n: number }> })
    | null;
  const dlqRows = dlq ? (Array.isArray(dlq) ? dlq : (dlq.rows ?? [])) : [];

  return {
    strandedCount: rows.length,
    orderIds: rows.map((r) => Number(r.id)),
    sample: rows.slice(0, 50).map((r) => r.order_number),
    oldest: rows[0]?.placed_at ?? null,
    queueFailed: Number(failedRows[0]?.n ?? 0),
    dlq: Number(dlqRows[0]?.n ?? 0),
  };
}

/** Stamp erp_stranded_alerted_at = now() on the given order IDs. */
export async function markStrandedAlerted(orderIds: number[]): Promise<void> {
  if (orderIds.length === 0) return;
  await db.execute(sql`
    UPDATE orders
       SET erp_stranded_alerted_at = now()
     WHERE id = ANY(${sql.raw(`ARRAY[${orderIds.join(",")}]::int[]`)})
  `);
}
