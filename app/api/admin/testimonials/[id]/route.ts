import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { testimonials } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { invalidate } from "@/lib/cache";

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
  const guard = await requirePermission("testimonials.write");
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
  await db.update(testimonials).set(update).where(eq(testimonials.id, id));
  await bust();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("testimonials.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  await db.delete(testimonials).where(eq(testimonials.id, id));
  await bust();
  return NextResponse.json({ ok: true });
}
