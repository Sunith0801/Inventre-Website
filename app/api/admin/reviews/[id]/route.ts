import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reviews } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";

const Body = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("reviews.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const [before] = await db
    .select({ status: reviews.status })
    .from(reviews)
    .where(eq(reviews.id, id))
    .limit(1);
  await db.update(reviews).set({ status: body.status }).where(eq(reviews.id, id));
  if (before && before.status !== body.status) {
    void logAdminActivity(guard, {
      action: "review.moderate",
      entityType: "review",
      entityId: id,
      summary: `Status: ${before.status} → ${body.status}`,
      changes: [{ field: "status", label: "Status", old: before.status, new: body.status }],
      req,
    });
  }
  return NextResponse.json({ ok: true });
}
