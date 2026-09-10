/**
 * Sweep job: walk every product_images row whose `url` is still an
 * upstream ERP URL, mirror the bytes into MinIO, rewrite `url` to the
 * local mirror. Idempotent — rows already pointing at MinIO are skipped
 * by the rehoster's fast path.
 *
 * Runs detached via setImmediate and persists its report in
 * `backgroundJobs` (jobType="erp_media_rehost").
 */

import { db, schema } from "@/db/client";
import { and, eq, isNotNull, like, ne, sql } from "drizzle-orm";
import { rehostRemoteImage } from "@/server/erp/media-rehoster";
import { currentBackend } from "@/server/erp/media-backend";

export const ERP_MEDIA_REHOST_JOB_TYPE = "erp_media_rehost";

export type MediaRehostReport = {
  scanned: number;
  mirrored: number;
  alreadyMirrored: number;
  skippedLocal: number;
  failed: number;
  bytesDownloaded: number;
  errors: { url: string; reason: string }[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type RehostOptions = {
  // Limit how many rows to process per run — useful for chunking through
  // a large backlog. Omit for "all of them".
  limit?: number;
  // Concurrency for fan-out fetches. Default 6 to be polite to the ERP host.
  concurrency?: number;
};

async function findRowsToRehost(limit?: number) {
  // "Already local" patterns vary per backend.
  //   s3:    starts with S3_PUBLIC_URL  (e.g. http://localhost:9000/inventre/erp-media/…)
  //   local: starts with /erp-media/    (served by Next from public/erp-media/)
  const backend = currentBackend();
  const localPrefix =
    backend === "s3"
      ? (process.env.S3_PUBLIC_URL ?? "")
      : (process.env.ERP_MEDIA_LOCAL_URL ?? "/erp-media") + "/";

  const baseQuery = db
    .select({
      id: schema.productImages.id,
      url: schema.productImages.url,
      erpSourceUrl: schema.productImages.erpSourceUrl,
    })
    .from(schema.productImages)
    .where(
      and(
        isNotNull(schema.productImages.erpSourceUrl),
        localPrefix
          ? sql`${schema.productImages.url} NOT LIKE ${localPrefix + "%"}`
          : sql`true`
      )
    );
  return limit ? await baseQuery.limit(limit) : await baseQuery;
}

export async function runErpMediaRehost(opts: RehostOptions = {}): Promise<MediaRehostReport> {
  const startedAt = new Date();
  const startMs = Date.now();
  const concurrency = Math.max(1, Math.min(20, opts.concurrency ?? 6));

  const rows = await findRowsToRehost(opts.limit);
  const report: MediaRehostReport = {
    scanned: rows.length,
    mirrored: 0,
    alreadyMirrored: 0,
    skippedLocal: 0,
    failed: 0,
    bytesDownloaded: 0,
    errors: [],
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    durationMs: 0,
  };

  // Simple worker pool — split rows into N parallel queues.
  const queues: typeof rows[] = Array.from({ length: concurrency }, () => []);
  rows.forEach((r, i) => queues[i % concurrency].push(r));

  await Promise.all(
    queues.map(async (q) => {
      for (const row of q) {
        const upstreamUrl = row.erpSourceUrl ?? row.url;
        const outcome = await rehostRemoteImage(upstreamUrl);
        if (outcome.status === "mirrored") {
          report.mirrored++;
          report.bytesDownloaded += outcome.bytes;
          await db
            .update(schema.productImages)
            .set({ url: outcome.localUrl })
            .where(eq(schema.productImages.id, row.id));
        } else if (outcome.status === "already_mirrored") {
          report.alreadyMirrored++;
          if (row.url !== outcome.localUrl) {
            await db
              .update(schema.productImages)
              .set({ url: outcome.localUrl })
              .where(eq(schema.productImages.id, row.id));
          }
        } else if (outcome.status === "skipped_local") {
          report.skippedLocal++;
        } else {
          report.failed++;
          if (report.errors.length < 20) {
            report.errors.push({ url: upstreamUrl, reason: outcome.reason });
          }
        }
      }
    })
  );

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startMs;
  return report;
}

export async function enqueueErpMediaRehost(
  trigger: "admin" | "cron" | "post-sync",
  opts: RehostOptions = {}
): Promise<{ jobId: string; alreadyRunning: boolean }> {
  const inFlight = await db
    .select({ id: schema.backgroundJobs.id })
    .from(schema.backgroundJobs)
    .where(
      and(
        eq(schema.backgroundJobs.jobType, ERP_MEDIA_REHOST_JOB_TYPE),
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
      jobType: ERP_MEDIA_REHOST_JOB_TYPE,
      status: "running",
      payload: { trigger, opts },
      attempts: 1,
      startedAt: new Date(),
    })
    .returning({ id: schema.backgroundJobs.id });

  setImmediate(async () => {
    let report: MediaRehostReport | null = null;
    let errorMessage: string | null = null;
    try {
      report = await runErpMediaRehost(opts);
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
