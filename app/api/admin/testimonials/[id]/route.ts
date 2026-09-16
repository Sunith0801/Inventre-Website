import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { testimonials } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { invalidate } from "@/server/cache";
import { logAdminActivity, diffFields } from "@/server/activity";

const Body = z.object({
  principalName: z.string().optional(),
  role: z.string().optional(),
  shortLabel: z.string().nullable().optional(),
  quote: z.string().optional(),
  photoUrl: z.string().nullable().optional(),
  isFeatured: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  schoolId: z.string().nullable().optional(),
});

async function bust() {
  await invalidate("home:all");
  revalidatePath("/");
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("content.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const update: Record<string, unknown> = {};
  for (const k of Object.keys(body) as (keyof typeof body)[]) {
    if (body[k] !== undefined)
      update[k] = body[k] === "" ? null : body[k];
  }
  const [before] = await db
    .select()
    .from(testimonials)
    .where(eq(testimonials.id, id))
    .limit(1);
  await db.update(testimonials).set(update).where(eq(testimonials.id, id));
  await bust();
  if (before) {
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      update,
      {
        principalName: "Principal Name",
        role: "Role",
        shortLabel: "Short Label",
        quote: "Quote",
        photoUrl: "Photo URL",
        isFeatured: "Featured",
        sortOrder: "Sort Order",
        schoolId: "School",
      }
    );
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "testimonial.update",
        entityType: "testimonial",
        entityId: id,
        summary: `Updated ${changes.map((c) => c.label ?? c.field).join(", ")}`,
        changes,
        req,
      });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("content.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [before] = await db
    .select()
    .from(testimonials)
    .where(eq(testimonials.id, id))
    .limit(1);
  await db.delete(testimonials).where(eq(testimonials.id, id));
  await bust();
  void logAdminActivity(guard, {
    action: "testimonial.delete",
    entityType: "testimonial",
    entityId: id,
    summary: `Deleted testimonial ${before?.principalName ?? id}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
