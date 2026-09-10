import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { parseJson } from "@/server/api-handler";
import { logAdminActivity, diffFields } from "@/server/activity";

const Patch = z.object({
  schoolCode: z.string().min(1).max(40).optional(),
  schoolName: z.string().min(1).optional(),
  branchName: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
  schoolLogoUrl: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  pincode: z.string().nullable().optional(),
  uniformDetailsCheckbox: z.boolean().optional(),
  booksDetailsCheckbox: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const body = await parseJson(req, Patch);
  if (body instanceof NextResponse) return body;

  const update: Record<string, unknown> = { syncedAt: new Date() };
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (k === "status") {
      update.status = v === "Inactive" ? "paused" : "active";
    } else {
      update[k] = v;
    }
  }
  // Keep storefront `name` in sync with `schoolName` on every write.
  if (body.schoolName !== undefined) update.name = body.schoolName;

  const [before] = await db.select().from(schema.schools).where(eq(schema.schools.id, id)).limit(1);
  await db.update(schema.schools).set(update).where(eq(schema.schools.id, id));
  if (before) {
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      update,
      {
        schoolCode: "School code",
        schoolName: "School name",
        name: "Name",
        branchName: "Branch",
        websiteUrl: "Website",
        status: "Status",
        schoolLogoUrl: "Logo URL",
        street: "Street",
        city: "City",
        state: "State",
        country: "Country",
        pincode: "Pincode",
        uniformDetailsCheckbox: "Uniform details",
        booksDetailsCheckbox: "Books details",
      }
    );
    // syncedAt is always set; ignore it as a meaningful change.
    const meaningful = changes.filter((c) => c.field !== "syncedAt");
    if (meaningful.length > 0) {
      void logAdminActivity(guard, {
        action: "school.update",
        entityType: "school",
        entityId: id,
        summary: `Updated ${meaningful.map((c) => c.label ?? c.field).join(", ")}`,
        changes: meaningful,
        req,
      });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [before] = await db.select().from(schema.schools).where(eq(schema.schools.id, id)).limit(1);
  await db.delete(schema.schools).where(eq(schema.schools.id, id));
  void logAdminActivity(guard, {
    action: "school.delete",
    entityType: "school",
    entityId: id,
    summary: `Deleted school ${before?.schoolName ?? before?.name ?? id}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
