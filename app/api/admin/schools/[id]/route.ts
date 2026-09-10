import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { schools } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity, diffFields } from "@/server/activity";

const Body = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  status: z.enum(["active", "onboarding", "paused"]).optional(),
  isFeatured: z.boolean().optional(),
  // Toggle from the Catalog Setup hub to silence the "Needs work" pill
  // when remaining gaps are intentional.
  isSetupComplete: z.boolean().optional(),
  contactEmail: z.string().email().or(z.literal("")).nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  bannerUrl: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const update: Record<string, unknown> = {};
  for (const k of Object.keys(body) as (keyof typeof body)[]) {
    const val = body[k];
    if (val !== undefined) {
      if (typeof val === "string" && val === "" && k !== "name" && k !== "slug")
        update[k] = null;
      else update[k] = val;
    }
  }
  const [before] = await db.select().from(schools).where(eq(schools.id, id)).limit(1);
  await db.update(schools).set(update).where(eq(schools.id, id));
  if (before) {
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      update,
      {
        name: "Name",
        slug: "Slug",
        city: "City",
        state: "State",
        status: "Status",
        isFeatured: "Featured",
        isSetupComplete: "Setup complete",
        contactEmail: "Contact email",
        contactPhone: "Contact phone",
        bannerUrl: "Banner URL",
        logoUrl: "Logo URL",
      }
    );
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "school.update",
        entityType: "school",
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
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [before] = await db.select().from(schools).where(eq(schools.id, id)).limit(1);
  await db.delete(schools).where(eq(schools.id, id));
  void logAdminActivity(guard, {
    action: "school.delete",
    entityType: "school",
    entityId: id,
    summary: `Deleted school ${before?.name ?? id}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
