/**
 * Headless ERPNext Education sync (schools, grades, guardians, students),
 * job-tracked so hourly cron runs show up in the admin UI
 * (/admin/settings/erp-sync) alongside manual syncs.
 *
 * Mirrors lib/jobs/erpnext-education-sync.ts but runs SYNCHRONOUSLY
 * (the enqueue helper uses fire-and-forget setImmediate, which a CLI
 * process would exit before completing). Writes a background_jobs row,
 * runs the importer, then finalizes the row.
 *
 * Env required: DATABASE_URL, ERPNEXT_BASE, ERPNEXT_TOKEN.
 * Exits 0 on success, 1 on hard failure, 0 (no-op) if already running.
 */
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { runErpNextEducationSync } from "@/server/importers/erpnext-education";
import { ERPNEXT_EDUCATION_JOB_TYPE } from "@/server/jobs/erpnext-education-sync";

async function main() {
  console.log(`[sync-education] start ${new Date().toISOString()}`);

  // Dedupe: skip if a run (manual or cron) is already in flight.
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
  if (inFlight[0]) {
    console.log(`[sync-education] already running (job ${inFlight[0].id}) — skipping`);
    process.exit(0);
  }

  const [job] = await db
    .insert(schema.backgroundJobs)
    .values({
      jobType: ERPNEXT_EDUCATION_JOB_TYPE,
      status: "running",
      payload: { trigger: "cron", opts: {} },
      attempts: 1,
      startedAt: new Date(),
    })
    .returning({ id: schema.backgroundJobs.id });

  let report: unknown = null;
  let errorMessage: string | null = null;
  try {
    report = await runErpNextEducationSync();
  } catch (e) {
    errorMessage = e instanceof Error ? e.stack ?? e.message : String(e);
  }

  await db
    .update(schema.backgroundJobs)
    .set({
      status: errorMessage ? "failed" : "completed",
      result: (report as object) ?? null,
      lastError: errorMessage,
      finishedAt: new Date(),
    })
    .where(eq(schema.backgroundJobs.id, job.id));

  if (errorMessage) {
    console.error(`[sync-education] FAILED (job ${job.id}): ${errorMessage}`);
    process.exit(1);
  }
  console.log(`[sync-education] completed (job ${job.id})`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(`[sync-education] UNCAUGHT: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
