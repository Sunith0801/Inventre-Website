import { NextResponse } from "next/server";
import crypto from "crypto";
import { pollOpenOrders } from "@/lib/erp-poll";
import { getErpConfig } from "@/lib/erp-config";
import { erpInboundDisabledResponse } from "@/lib/erp-inbound-guard";

/**
 * Cron-only entry point for the ERP status poller.
 *
 * Auth: shared CRON_TOKEN, same header as /api/cron/erp-drain.
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
  // Admin panel is the canonical backend (2026-05-28). ERP inbound
  // is gated so a misfired cron / leftover schedule can't overwrite
  // the cleaned-up student/guardian/parent data.
  const off = erpInboundDisabledResponse();
  if (off) return off;
  const result = await pollOpenOrders();
  return NextResponse.json({ ok: true, target: cfg.target, ...result });
}
