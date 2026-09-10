import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { isResponse, requirePermission } from "@/server/admin-guard";

/**
 * Force a queued ERP push to drain immediately by zeroing its
 * `scheduled_for`. The drain cron picks it up on the next tick.
 *
 *   PATCH /api/admin/erp-bridge/send-now/{queue_id}
 *   PATCH /api/admin/erp-bridge/send-now/{queue_id}?retry=1   ← also resets failed→pending
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("settings-erp-bridge.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const url = new URL(req.url);
  const retry = url.searchParams.get("retry") === "1";

  if (retry) {
    await db.execute(sql`
      UPDATE erp_outbound_queue
         SET status        = 'pending',
             scheduled_for = now(),
             attempts      = 0,
             last_error    = NULL
       WHERE id = ${id}
         AND status IN ('pending','failed')
    `);
  } else {
    await db.execute(sql`
      UPDATE erp_outbound_queue
         SET scheduled_for = now()
       WHERE id = ${id}
         AND status = 'pending'
    `);
  }
  return NextResponse.json({ ok: true });
}
