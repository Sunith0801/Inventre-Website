import { NextResponse } from "next/server";
import { acquireCronLock, cronLockedResponse, requireCron } from "@/server/cron-auth";
import { processWebhookRetries } from "@/server/notify/event-bus";

/**
 * Cron entry — run every minute to flush failed webhook deliveries.
 * Protected by a shared secret in `Authorization: Bearer <CRON_TOKEN>`.
 */
export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  const lock = await acquireCronLock("retry-webhooks", 30);
  if (!lock) return cronLockedResponse("retry-webhooks");
  try {
    const result = await processWebhookRetries();
    return NextResponse.json(result);
  } finally {
    await lock.release();
  }
}
