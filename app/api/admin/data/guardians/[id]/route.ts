import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity, diffFields } from "@/lib/activity";
import { parseJson } from "@/lib/api-handler";
import { phone10Schema, phone10NullableSchema } from "@/lib/phone";

const Patch = z.object({
  guardianName: z.string().min(1).optional(),
  emailAddress: z.string().nullable().optional(),
  mobileNumber: phone10Schema.optional(),
  email: z.string().nullable().optional(),
  alternateNumber: phone10NullableSchema.optional(),
  dateOfBirth: z.string().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("guardians.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const body = await parseJson(req, Patch);
  if (body instanceof NextResponse) return body;

  const [before] = await db
    .select()
    .from(schema.guardians)
    .where(eq(schema.guardians.id, id))
    .limit(1);

  const update: Record<string, unknown> = { syncedAt: new Date() };
  for (const [k, v] of Object.entries(body)) if (v !== undefined) update[k] = v;
  await db.update(schema.guardians).set(update).where(eq(schema.guardians.id, id));

  if (before) {
    const { syncedAt: _syncedAt, ...afterForDiff } = update;
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      afterForDiff,
      {
        guardianName: "Guardian name",
        emailAddress: "Email address",
        mobileNumber: "Mobile number",
        email: "Email",
        alternateNumber: "Alternate number",
        dateOfBirth: "Date of birth",
      }
    );
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "guardian.update",
        entityType: "guardian",
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
  const guard = await requirePermission("guardians.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;

  const [before] = await db
    .select({ guardianName: schema.guardians.guardianName })
    .from(schema.guardians)
    .where(eq(schema.guardians.id, id))
    .limit(1);

  await db.delete(schema.guardians).where(eq(schema.guardians.id, id));

  void logAdminActivity(guard, {
    action: "guardian.delete",
    entityType: "guardian",
    entityId: id,
    summary: `Deleted guardian ${before?.guardianName ?? id}`,
    req,
  });

  return NextResponse.json({ ok: true });
}
