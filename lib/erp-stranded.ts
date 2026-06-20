import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Stranded-order detector for the audit (ERP) outbound sync.
 *
 * The business invariant: every confirmed + paid order should mirror to
 * audit and end up with a non-empty `orders.erp_so_name`. When ingest
 * fails 5×, its `erp_outbound_queue` row goes to `failed` and is NEVER
 * retried — so a paid order can silently sit unmirrored for days (this is
 * exactly what stranded 182 orders on 2026-06-05 → 06-16).
 *
 * This surfaces that gap so the daily/hourly alert cron can email ops the
 * moment it appears, instead of someone noticing a missing order weeks
 * later. We key off the order-level invariant (paid + confirmed + no
 * erp_so_name, older than a grace window) rather than the queue alone, so
 * it also catches orders that never got a queue row at all.
 */

export interface StrandedReport {
  /** Paid+confirmed orders with no erp_so_name, older than the grace window. */
  strandedCount: number;
  /** Up to 50 sample order numbers for the alert body. */
  sample: string[];
  oldest: string | null;
  /** Diagnostic queue counts. */
  queueFailed: number;
  dlq: number;
}

export async function findStrandedOrders(
  graceHours: number
): Promise<StrandedReport> {
  const strandedRows = (await db.execute(sql`
    SELECT o.order_number, o.placed_at
      FROM orders o
     WHERE o.status = 'confirmed'
       AND o.payment_status = 'paid'
       AND (o.erp_so_name IS NULL OR o.erp_so_name = '')
       AND o.placed_at < now() - (${graceHours} * interval '1 hour')
     ORDER BY o.placed_at ASC
  `)) as unknown as
    | Array<{ order_number: string; placed_at: string }>
    | { rows?: Array<{ order_number: string; placed_at: string }> };
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
    sample: rows.slice(0, 50).map((r) => r.order_number),
    oldest: rows[0]?.placed_at ?? null,
    queueFailed: Number(failedRows[0]?.n ?? 0),
    dlq: Number(dlqRows[0]?.n ?? 0),
  };
}
