import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { enqueueErpItemSync, ERP_ITEM_SYNC_JOB_TYPE } from "@/lib/jobs/erp-item-sync";
import { erpInboundDisabledResponse } from "@/lib/erp-inbound-guard";

const Body = z.object({
  itemGroup: z.string().optional(),
  includeDeleted: z.boolean().optional(),
  pageSize: z.number().int().min(50).max(5000).optional(),
  maxItems: z.number().int().min(1).optional(),
});

export async function POST(req: Request) {
  const guard = await requirePermission("settings-erp-bridge.write");
  if (isResponse(guard)) return guard;
  const off = erpInboundDisabledResponse();
  if (off) return off;
  // Empty / no body is allowed (means "run with defaults"). Malformed JSON
  // is a 400. Schema validation failures are a 400 with details.
  let raw: unknown = {};
  if (req.headers.get("content-length") !== "0") {
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
    }
  }
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 }
    );
  }
  const { jobId, alreadyRunning } = await enqueueErpItemSync("admin", parsed.data);
  return NextResponse.json({ jobId, alreadyRunning });
}

/**
 * GET — return the most recent N runs (status + result). Used by the
 * admin settings page to render history without separate polling logic.
 */
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
    .where(eq(schema.backgroundJobs.jobType, ERP_ITEM_SYNC_JOB_TYPE))
    .orderBy(desc(schema.backgroundJobs.createdAt))
    .limit(20);
  return NextResponse.json({ runs: rows });
}
