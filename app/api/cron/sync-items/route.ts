import { NextResponse } from "next/server";
import { enqueueErpItemSync } from "@/server/jobs/erp-item-sync";
import { erpInboundDisabledResponse } from "@/server/erp-inbound-guard";

/**
 * Scheduled trigger for the ERP item sync.
 *
 * Call from any external scheduler (Coolify cron, GitHub Action, Hetzner
 * systemd timer) at e.g. 03:00 IST nightly:
 *
 *   GET /api/cron/sync-items
 *   Header: X-Cron-Key: $CRON_KEY
 *
 * 401 if the header is wrong; 503 if CRON_KEY isn't configured (fails
 * closed). Returns the backgroundJobs id so the scheduler can log it.
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_KEY;
  if (!expected) {
    return NextResponse.json({ error: "CRON_KEY not configured" }, { status: 503 });
  }
  const provided = req.headers.get("x-cron-key");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const off = erpInboundDisabledResponse();
  if (off) return off;
  const { jobId, alreadyRunning } = await enqueueErpItemSync("cron");
  return NextResponse.json({ jobId, alreadyRunning });
}
