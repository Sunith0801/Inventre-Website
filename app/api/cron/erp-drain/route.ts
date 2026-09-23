import { NextResponse } from "next/server";
import { requireCron } from "@/server/cron-auth";
import { drainOutboundQueue } from "@/server/erp-drain";
import { getErpConfig } from "@/server/erp-config";

/**
 * Cron-only entry point for the buffered-outbox drainer.
 *
 * Auth: shared CRON_TOKEN in the `Authorization: Bearer ...` header,
 * compared in constant time. Same token gates /api/cron/erp-poll.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cfg = getErpConfig();
  const denied = requireCron(req);
  if (denied) return denied;
  const result = await drainOutboundQueue();
  return NextResponse.json({ ok: true, target: cfg.target, ...result });
}
