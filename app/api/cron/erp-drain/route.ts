import { NextResponse } from "next/server";
import crypto from "crypto";
import { drainOutboundQueue } from "@/server/erp-drain";
import { getErpConfig } from "@/server/erp-config";

/**
 * Cron-only entry point for the buffered-outbox drainer.
 *
 * Auth: shared CRON_TOKEN in the `Authorization: Bearer ...` header,
 * compared in constant time. Same token gates /api/cron/erp-poll.
 */
export const dynamic = "force-dynamic";

function timingSafeEq(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

export async function POST(req: Request) {
  const cfg = getErpConfig();
  if (!cfg.cronToken) {
    return NextResponse.json({ error: "CRON_TOKEN not set" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !timingSafeEq(supplied, cfg.cronToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await drainOutboundQueue();
  return NextResponse.json({ ok: true, target: cfg.target, ...result });
}
