import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import { logAdminActivity, diffFields } from "@/lib/activity";

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
  const { id: schoolId, rowId } = await params;
  const body = await parseJson(req, Patch);
  if (body instanceof NextResponse) return body;
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) update[k] = v;
  const [before] = await db.select().from(schema.schoolCoordinators).where(eq(schema.schoolCoordinators.id, rowId)).limit(1);
  await db.update(schema.schoolCoordinators).set(update).where(eq(schema.schoolCoordinators.id, rowId));
  if (before) {
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      update,
      {
        pocName: "Name",
        email: "Email",
        contactNumber: "Contact number",
        alternateNumber: "Alternate number",
        role: "Role",
      }
    );
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "school.coordinator.update",
        entityType: "school",
        entityId: schoolId,
        summary: `Updated coordinator ${before.pocName ?? before.email ?? rowId}: ${changes.map((c) => c.label ?? c.field).join(", ")}`,
        changes,
        req,
      });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id: schoolId, rowId } = await params;
  const [before] = await db.select().from(schema.schoolCoordinators).where(eq(schema.schoolCoordinators.id, rowId)).limit(1);
  await db.delete(schema.schoolCoordinators).where(eq(schema.schoolCoordinators.id, rowId));
  void logAdminActivity(guard, {
    action: "school.coordinator.delete",
    entityType: "school",
    entityId: schoolId,
    summary: `Removed coordinator ${before?.pocName ?? before?.email ?? rowId}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
