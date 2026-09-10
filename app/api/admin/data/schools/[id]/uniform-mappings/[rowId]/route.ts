import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity } from "@/server/activity";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id: schoolId, rowId } = await params;
  const [before] = await db.select().from(schema.schoolUniformMappings).where(eq(schema.schoolUniformMappings.id, rowId)).limit(1);
  await db.delete(schema.schoolUniformMappings).where(eq(schema.schoolUniformMappings.id, rowId));
  void logAdminActivity(guard, {
    action: "school.uniform_mapping.delete",
    entityType: "school",
    entityId: schoolId,
    summary: `Removed uniform mapping ${before?.grade ?? rowId}${before?.houseName ? ` · ${before.houseName}` : ""}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
