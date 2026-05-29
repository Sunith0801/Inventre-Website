import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import {
  enqueueErpNextEducationSync,
  ERPNEXT_EDUCATION_JOB_TYPE,
} from "@/lib/jobs/erpnext-education-sync";
import { erpInboundDisabledResponse } from "@/lib/erp-inbound-guard";

const Body = z.object({
  maxStudents: z.number().int().min(1).optional(),
  maxGuardians: z.number().int().min(1).optional(),
  skipLarge: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const off = erpInboundDisabledResponse();
  if (off) return off;
  let raw: unknown = {};
  if (req.headers.get("content-length") !== "0") {
    try { raw = await req.json(); } catch {
      return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
    }
  }
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 }
    );
  }
  const { jobId, alreadyRunning } = await enqueueErpNextEducationSync("admin", parsed.data);
  return NextResponse.json({ jobId, alreadyRunning });
}

export async function GET() {
  const guard = await requireAdmin("super", "ops");
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
    .where(eq(schema.backgroundJobs.jobType, ERPNEXT_EDUCATION_JOB_TYPE))
    .orderBy(desc(schema.backgroundJobs.createdAt))
    .limit(10);
  return NextResponse.json({ runs: rows });
}
