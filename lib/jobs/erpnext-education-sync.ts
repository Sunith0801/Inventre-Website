/**
 * Background-job wrapper around the ERPNext Education importer.
 * Same shape as lib/jobs/erp-item-sync.ts.
 */
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import {
  runErpNextEducationSync,
  type EducationSyncOptions,
  type EducationSyncReport,
} from "@/lib/importers/erpnext-education";

export const ERPNEXT_EDUCATION_JOB_TYPE = "erpnext_education_sync";

export async function enqueueErpNextEducationSync(
  trigger: "admin" | "cron",
  opts: EducationSyncOptions = {}
): Promise<{ jobId: string; alreadyRunning: boolean }> {
  const inFlight = await db
    .select({ id: schema.backgroundJobs.id })
    .from(schema.backgroundJobs)
    .where(
      and(
        eq(schema.backgroundJobs.jobType, ERPNEXT_EDUCATION_JOB_TYPE),
        eq(schema.backgroundJobs.status, "running")
      )
    )
    .limit(1);
  if (inFlight[0]) return { jobId: inFlight[0].id, alreadyRunning: true };

  const [job] = await db
    .insert(schema.backgroundJobs)
    .values({
      jobType: ERPNEXT_EDUCATION_JOB_TYPE,
      status: "running",
      payload: { trigger, opts },
      attempts: 1,
      startedAt: new Date(),
    })
    .returning({ id: schema.backgroundJobs.id });

  setImmediate(async () => {
    let report: EducationSyncReport | null = null;
    let errorMessage: string | null = null;
    try {
      report = await runErpNextEducationSync(opts);
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
