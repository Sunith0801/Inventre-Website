import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const { id: studentId, rowId } = await params;

  const [before] = await db
    .select({ fullName: schema.studentSiblings.fullName })
    .from(schema.studentSiblings)
    .where(eq(schema.studentSiblings.id, rowId))
    .limit(1);

  await db.delete(schema.studentSiblings).where(eq(schema.studentSiblings.id, rowId));

  void logAdminActivity(guard, {
    action: "student.sibling.delete",
    entityType: "student",
    entityId: studentId,
    summary: `Removed sibling ${before?.fullName ?? rowId}`,
    req,
  });

  return NextResponse.json({ ok: true });
}
