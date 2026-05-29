import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const { rowId } = await params;
  await db.delete(schema.studentSiblings).where(eq(schema.studentSiblings.id, rowId));
  return NextResponse.json({ ok: true });
}
