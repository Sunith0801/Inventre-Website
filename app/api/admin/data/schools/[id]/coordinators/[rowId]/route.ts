import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";

const Patch = z.object({
  pocName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  contactNumber: z.string().nullable().optional(),
  alternateNumber: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { rowId } = await params;
  const body = await parseJson(req, Patch);
  if (body instanceof NextResponse) return body;
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) update[k] = v;
  await db.update(schema.schoolCoordinators).set(update).where(eq(schema.schoolCoordinators.id, rowId));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { rowId } = await params;
  await db.delete(schema.schoolCoordinators).where(eq(schema.schoolCoordinators.id, rowId));
  return NextResponse.json({ ok: true });
}
