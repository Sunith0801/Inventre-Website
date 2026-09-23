import { NextResponse } from "next/server";
import { acquireCronLock, cronLockedResponse, requireCron } from "@/server/cron-auth";
import { enqueueErpItemSync } from "@/server/jobs/erp-item-sync";
import { erpInboundDisabledResponse } from "@/server/erp-inbound-guard";

/**
 * Scheduled trigger for the ERP item sync.
 *
 * Call from any external scheduler (Coolify cron, GitHub Action, Hetzner
 * systemd timer) at e.g. 03:00 IST nightly:
 *
 *   GET /api/cron/sync-items
 *   Header: Authorization: Bearer $CRON_TOKEN
 *
 * 401 if the header is wrong; 503 if CRON_TOKEN isn't configured (fails
 * closed). Returns the backgroundJobs id so the scheduler can log it.
 */
export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const lock = await acquireCronLock("sync-items", 60);
  if (!lock) return cronLockedResponse("sync-items");
  try {
    const off = erpInboundDisabledResponse();
    if (off) return off;
    const { jobId, alreadyRunning } = await enqueueErpItemSync("cron");
    return NextResponse.json({ jobId, alreadyRunning });
  } finally {
    await lock.release();
  }
}
