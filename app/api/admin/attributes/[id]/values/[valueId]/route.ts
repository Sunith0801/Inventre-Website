import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productAttributeValues } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";

const Body = z.object({
  value: z.string().min(1).optional(),
  shortCode: z.string().nullable().optional(),
  displayLabel: z.string().nullable().optional(),
  hexColor: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; valueId: string }> }
) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const { valueId } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) update[k] = v;
  }
  await db
    .update(productAttributeValues)
    .set(update)
    .where(eq(productAttributeValues.id, valueId));
  // Attribute values populate `attributeGroups[].values` in cached
  // product DTOs and feed the multi-axis picker on the PDP.
  await invalidateCatalog();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; valueId: string }> }
) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const { valueId } = await params;
  await db
    .delete(productAttributeValues)
    .where(eq(productAttributeValues.id, valueId));
  await invalidateCatalog();
  return NextResponse.json({ ok: true });
}
