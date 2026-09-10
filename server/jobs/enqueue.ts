import "server-only";
import { db } from "@/db/client";
import { backgroundJobs } from "@/db/schema";

/**
 * Stub enqueue — writes a row to background_jobs. No worker reads it yet.
 *
 * Replace the body of this function once a runner (pg-boss / BullMQ) is wired:
 * existing call sites (lib/notifications.ts, etc.) won't need to change.
 */
export type JobName =
  | "send_email"
  | "send_sms"
  | "erp_push_so"
  | "erp_pull_stock";

export async function enqueue(
  job: JobName,
  payload: Record<string, unknown>
): Promise<{ id: string } | null> {
  try {
    const [row] = await db
      .insert(backgroundJobs)
      .values({
        jobType: job,
        payload,
        status: "queued",
      })
      .returning({ id: backgroundJobs.id });
    return row;
  } catch {
    // Don't let a queue failure break a request path. Log and drop.
    return null;
  }
}
