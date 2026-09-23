import { NextResponse } from "next/server";
import { acquireCronLock, cronLockedResponse, requireCron } from "@/server/cron-auth";
import { pollOpenOrders } from "@/server/erp-poll";
import { getErpConfig } from "@/server/erp-config";
import {
  erpOrderPollDisabledResponse,
  isOrderPollOnlyMode,
} from "@/server/erp-inbound-guard";

/**
 * Cron-only entry point for the ERP status poller.
 *
 * Auth: shared CRON_TOKEN, same header as /api/cron/erp-drain.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cfg = getErpConfig();
  const denied = requireCron(req);
  if (denied) return denied;
  const lock = await acquireCronLock("erp-poll", 25);
  if (!lock) return cronLockedResponse("erp-poll");
  try {
    // Admin panel is the canonical backend (2026-05-28). The narrow
    // order-poll gate lets storefront status flow back from audit while
    // the master inbound switch keeps student/guardian/customer/item
    // mirrors locked.
    const off = erpOrderPollDisabledResponse();
    if (off) return off;
    const ordersOnly = isOrderPollOnlyMode();
    const result = await pollOpenOrders({ ordersOnly });
    return NextResponse.json({ ok: true, target: cfg.target, ordersOnly, ...result });
  } finally {
    await lock.release();
  }
}
