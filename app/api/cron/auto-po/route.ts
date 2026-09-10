import { NextResponse } from "next/server";
import { runAutoPo } from "@/server/auto-po";

/**
 * Cron entry — run nightly to draft POs for low-stock variants.
 * Protected by `Authorization: Bearer <CRON_SECRET>`.
 *
 * Recommended cron: `0 2 * * *` (2 AM daily).
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runAutoPo();
  return NextResponse.json(result);
}
