/**
 * Background-job wrapper around lib/importers/erp-item.runErpItemSync.
 *
 * Records a row in `backgroundJobs` so the admin UI can poll status,
 * and prevents concurrent runs by checking for an existing `running` row.
 *
 * Returns the backgroundJobs id immediately; the actual sync runs
 * detached via setImmediate so callers don't block on it.
 */

import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { runErpItemSync, type SyncOptions, type SyncReport } from "@/server/importers/erp-item";

export const ERP_ITEM_SYNC_JOB_TYPE = "erp_item_sync";

export async function enqueueErpItemSync(
  trigger: "admin" | "cron",
  opts: SyncOptions = {}
): Promise<{ jobId: string; alreadyRunning: boolean }> {
  // Reject if a run is already in flight — the feed is small enough that
  // overlapping pulls would just waste DB work.
  const inFlight = await db
    .select({ id: schema.backgroundJobs.id })
    .from(schema.backgroundJobs)
    .where(
      and(
        eq(schema.backgroundJobs.jobType, ERP_ITEM_SYNC_JOB_TYPE),
        eq(schema.backgroundJobs.status, "running")
      )
    )
    .limit(1);
  if (inFlight[0]) {
    return { jobId: inFlight[0].id, alreadyRunning: true };
  }

  const [job] = await db
    .insert(schema.backgroundJobs)
    .values({
      jobType: ERP_ITEM_SYNC_JOB_TYPE,
      status: "running",
      payload: { trigger, opts },
      attempts: 1,
      startedAt: new Date(),
    })
    .returning({ id: schema.backgroundJobs.id });

  // Detach — caller gets the id back immediately. Errors are persisted
  // to the job row, not thrown back to the request.
  setImmediate(async () => {
    let report: SyncReport | null = null;
    let errorMessage: string | null = null;
    try {
      report = await runErpItemSync(opts);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }
    await db
      .update(schema.backgroundJobs)
      .set({
        status: errorMessage ? "failed" : "completed",
        result: report ?? null,
        lastError: errorMessage,
        finishedAt: new Date(),
      })
      .where(eq(schema.backgroundJobs.id, job.id));
  });

  return { jobId: job.id, alreadyRunning: false };
}
