import { NextResponse } from "next/server";
import { processWebhookRetries } from "@/server/notify/event-bus";

/**
 * Cron entry — run every minute to flush failed webhook deliveries.
 * Protected by a shared secret in `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await processWebhookRetries();
  return NextResponse.json(result);
}
