import { NextResponse } from "next/server";
import { acquireCronLock, cronLockedResponse, requireCron } from "@/server/cron-auth";
import { reconcileMissingAuditEvents } from "@/server/erp-reconcile";

/**
 * Cron-only entry point for the audit-sync reconciliation backstop.
 *
 * Auth: shared CRON_TOKEN in `Authorization: Bearer ...` — same token
 * the drain + poll routes use.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const lock = await acquireCronLock("erp-reconcile", 60);
  if (!lock) return cronLockedResponse("erp-reconcile");
  try {
    const result = await reconcileMissingAuditEvents();
    return NextResponse.json({ ok: true, ...result });
  } finally {
    await lock.release();
  }
}
