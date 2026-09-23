import { NextResponse } from "next/server";
import { acquireCronLock, cronLockedResponse, requireCron } from "@/server/cron-auth";
import { runGroundStockSync } from "@/server/ground-stock-sync";

/**
 * Cron entry for the Ground Stock bridge — audit ERP → admin Stock module →
 * storefront availability. Scheduled every 5 minutes (deploy/cron.d).
 *
 * Auth: shared CRON_TOKEN, same header as /api/cron/erp-poll.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function POST(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const lock = await acquireCronLock("ground-stock-sync", 240);
  if (!lock) return cronLockedResponse("ground-stock-sync");
  try {
    const result = await runGroundStockSync("cron");
    return NextResponse.json(result, { status: result.ok || result.skipped ? 200 : 502 });
  } finally {
    await lock.release();
  }
}
