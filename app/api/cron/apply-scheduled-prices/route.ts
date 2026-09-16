import { NextResponse } from "next/server";
import { applyScheduledPrices } from "@/server/admin/scheduled-prices";

/**
 * Daily: promote scheduled product prices whose effective date has come.
 * Auth: header `x-cron-token` must match env CRON_TOKEN, like cleanup-carts.
 * Install: deploy/cron.d/inventre-scheduled-prices.
 */
export async function POST(req: Request) {
  const expected = process.env.CRON_TOKEN;
  if (!expected) return NextResponse.json({ error: "CRON_TOKEN not configured" }, { status: 503 });
  if (req.headers.get("x-cron-token") !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { applied } = await applyScheduledPrices();
  return NextResponse.json({ ok: true, applied: applied.length, products: applied });
}
