import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productAttributeValues } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";
import { logAdminActivity, diffFields } from "@/lib/activity";

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
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id: attributeId, valueId } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) update[k] = v;
  }
  const [beforeRow] = await db
    .select()
    .from(productAttributeValues)
    .where(eq(productAttributeValues.id, valueId))
    .limit(1);
  await db
    .update(productAttributeValues)
    .set(update)
    .where(eq(productAttributeValues.id, valueId));
  // Attribute values populate `attributeGroups[].values` in cached
  // product DTOs and feed the multi-axis picker on the PDP.
  await invalidateCatalog();

  const changes = diffFields(
    (beforeRow ?? {}) as unknown as Record<string, unknown>,
    update,
    {
      value: "Value",
      shortCode: "Short Code",
      displayLabel: "Display Label",
      hexColor: "Hex Colour",
      imageUrl: "Image URL",
      sortOrder: "Sort Order",
      isActive: "Active",
    }
  );
  if (changes.length > 0) {
    void logAdminActivity(guard, {
      action: "attribute.value.update",
      entityType: "attribute",
      entityId: attributeId,
      summary: `Updated value ${beforeRow?.value ?? valueId}`,
      changes,
      req,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; valueId: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id: attributeId, valueId } = await params;
  const [beforeDelete] = await db
    .select({ value: productAttributeValues.value })
    .from(productAttributeValues)
    .where(eq(productAttributeValues.id, valueId))
    .limit(1);
  await db
    .delete(productAttributeValues)
    .where(eq(productAttributeValues.id, valueId));
  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "attribute.value.delete",
    entityType: "attribute",
    entityId: attributeId,
    summary: `Deleted value ${beforeDelete?.value ?? valueId}`,
    req,
  });

  return NextResponse.json({ ok: true });
}
