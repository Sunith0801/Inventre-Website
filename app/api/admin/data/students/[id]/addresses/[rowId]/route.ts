import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const guard = await requirePermission("students.write");
  if (isResponse(guard)) return guard;
  const { id: studentId, rowId } = await params;

  const [before] = await db
    .select({
      kind: schema.studentAddresses.kind,
      addressLine1: schema.studentAddresses.addressLine1,
      city: schema.studentAddresses.city,
    })
    .from(schema.studentAddresses)
    .where(eq(schema.studentAddresses.id, rowId))
    .limit(1);

  await db.delete(schema.studentAddresses).where(eq(schema.studentAddresses.id, rowId));

  void logAdminActivity(guard, {
    action: "student.address.delete",
    entityType: "student",
    entityId: studentId,
    summary: `Removed ${before?.kind ?? ""} address ${[before?.addressLine1, before?.city].filter(Boolean).join(", ") || rowId}`,
    req,
  });

  return NextResponse.json({ ok: true });
}
