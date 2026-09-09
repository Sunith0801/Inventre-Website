import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import { logAdminActivity, diffFields } from "@/lib/activity";

const Patch = z.object({
  gradeName: z.string().min(1).optional(),
  gradeCode: z.string().nullable().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("grades.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const body = await parseJson(req, Patch);
  if (body instanceof NextResponse) return body;
  const update: Record<string, unknown> = { syncedAt: new Date() };
  for (const [k, v] of Object.entries(body)) if (v !== undefined) update[k] = v;
  const [before] = await db.select().from(schema.grades).where(eq(schema.grades.id, id)).limit(1);
  await db.update(schema.grades).set(update).where(eq(schema.grades.id, id));
  if (before) {
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      update,
      { gradeName: "Grade name", gradeCode: "Grade code", status: "Status" }
    ).filter((c) => c.field !== "syncedAt");
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "grade.update",
        entityType: "grade",
        entityId: id,
        summary: `Updated ${changes.map((c) => c.label ?? c.field).join(", ")}`,
        changes,
        req,
      });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("grades.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [before] = await db.select().from(schema.grades).where(eq(schema.grades.id, id)).limit(1);
  await db.delete(schema.grades).where(eq(schema.grades.id, id));
  void logAdminActivity(guard, {
    action: "grade.delete",
    entityType: "grade",
    entityId: id,
    summary: `Deleted grade ${before?.gradeName ?? id}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
