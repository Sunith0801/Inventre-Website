import { NextResponse } from "next/server";
import { requireCron } from "@/server/cron-auth";
import { runAutoPo } from "@/server/auto-po";

/**
 * Cron entry — run nightly to draft POs for low-stock variants.
 * Protected by `Authorization: Bearer <CRON_TOKEN>`.
 *
 * Recommended cron: `0 2 * * *` (2 AM daily).
 */
export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const result = await runAutoPo();
  return NextResponse.json(result);
}
