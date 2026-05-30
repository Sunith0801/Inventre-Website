import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { schools } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";

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
  await db.update(schools).set(update).where(eq(schools.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  await db.delete(schools).where(eq(schools.id, id));
  return NextResponse.json({ ok: true });
}
