import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const { id: schoolId, rowId } = await params;

  // Constrain the DELETE to (rowId, schoolId) together. Without the schoolId
  // predicate, a craftable URL like .../schools/<A>/grade-mappings/<row-of-B>
  // would happily delete row B even though the URL claims school A. Returning
  // {rowsAffected:0} via the .returning() count lets us 404 cleanly.
  const deleted = await db
    .delete(schema.schoolGradeMappings)
    .where(
      and(
        eq(schema.schoolGradeMappings.id, rowId),
        eq(schema.schoolGradeMappings.schoolId, schoolId)
      )
    )
    .returning({ id: schema.schoolGradeMappings.id });

  if (deleted.length === 0) {
    return NextResponse.json(
      { error: "Grade mapping not found for this school" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
