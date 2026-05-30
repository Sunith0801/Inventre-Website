import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";

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
  await db.update(schema.grades).set(update).where(eq(schema.grades.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("grades.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  await db.delete(schema.grades).where(eq(schema.grades.id, id));
  return NextResponse.json({ ok: true });
}
