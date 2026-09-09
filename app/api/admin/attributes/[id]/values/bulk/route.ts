import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq, inArray, and, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { productAttributeValues } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { logAdminActivity } from "@/lib/activity";

/**
 * Bulk replace the value list for an attribute (mirrors the ERP "Save"
 * button on the attribute detail page).
 *
 * Behaviour:
 *   - Rows with an `id` field are UPDATEd.
 *   - Rows without an `id` are INSERTed.
 *   - Existing rows whose id is not in the incoming list are DELETEd.
 *   - sortOrder is taken from array position (1-based).
 *
 * Used by components/admin/AttributeEditor.tsx.
 */

const Row = z.object({
  id: z.string().uuid().optional(),
  value: z.string().min(1),
  displayLabel: z.string().nullable().optional(),
  shortCode: z.string().nullable().optional(),
  hexColor: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const Body = z.object({
  values: z.array(Row),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id: attributeId } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const { values } = parsed;

  // 1. Delete rows not in the incoming list.
  const keepIds = values.map((v) => v.id).filter((x): x is string => !!x);
  if (keepIds.length > 0) {
    await db
      .delete(productAttributeValues)
      .where(
        and(
          eq(productAttributeValues.attributeId, attributeId),
          notInArray(productAttributeValues.id, keepIds)
        )
      );
  } else {
    await db
      .delete(productAttributeValues)
      .where(eq(productAttributeValues.attributeId, attributeId));
  }

  // 2. Upsert each row, in order.
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v.id) {
      await db
        .update(productAttributeValues)
        .set({
          value: v.value,
          displayLabel: v.displayLabel ?? null,
          shortCode: v.shortCode ?? null,
          hexColor: v.hexColor ?? null,
          isActive: v.isActive ?? true,
          sortOrder: i + 1,
        })
        .where(eq(productAttributeValues.id, v.id));
    } else {
      await db
        .insert(productAttributeValues)
        .values({
          attributeId,
          value: v.value,
          displayLabel: v.displayLabel ?? null,
          shortCode: v.shortCode ?? null,
          hexColor: v.hexColor ?? null,
          isActive: v.isActive ?? true,
          sortOrder: i + 1,
        });
    }
  }

  void logAdminActivity(guard, {
    action: "attribute.value.bulk",
    entityType: "attribute",
    entityId: attributeId,
    summary: `Saved ${values.length} attribute value(s)`,
    req,
  });

  return NextResponse.json({ ok: true, count: values.length });
}
