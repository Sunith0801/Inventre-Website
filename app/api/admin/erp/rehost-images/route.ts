import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { isResponse, requirePermission } from "@/server/admin-guard";
import {
  enqueueErpMediaRehost,
  ERP_MEDIA_REHOST_JOB_TYPE,
} from "@/server/jobs/erp-media-rehost";

const Body = z.object({
  limit: z.number().int().min(1).optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("settings-erp-bridge.write");
  if (isResponse(guard)) return guard;
  const body = req.headers.get("content-length") === "0" ? {} : await req.json().catch(() => ({}));
  const opts = Body.parse(body ?? {});
  const { jobId, alreadyRunning } = await enqueueErpMediaRehost("admin", opts);
  return NextResponse.json({ jobId, alreadyRunning });
}

export async function GET() {
  const guard = await requirePermission("settings-erp-bridge.read");
  if (isResponse(guard)) return guard;
  const rows = await db
    .select({
      id: schema.backgroundJobs.id,
      status: schema.backgroundJobs.status,
      payload: schema.backgroundJobs.payload,
      result: schema.backgroundJobs.result,
      lastError: schema.backgroundJobs.lastError,
      startedAt: schema.backgroundJobs.startedAt,
      finishedAt: schema.backgroundJobs.finishedAt,
      createdAt: schema.backgroundJobs.createdAt,
    })
    .from(schema.backgroundJobs)
    .where(eq(schema.backgroundJobs.jobType, ERP_MEDIA_REHOST_JOB_TYPE))
    .orderBy(desc(schema.backgroundJobs.createdAt))
    .limit(20);
  return NextResponse.json({ runs: rows });
}
