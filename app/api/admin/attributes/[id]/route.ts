import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productAttributes } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";
import { normalizeAttributeName } from "@/lib/normalize-attribute-name";
import { logAdminActivity, diffFields } from "@/lib/activity";

const Body = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["size", "color", "design", "model", "other"]).optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isDisabled: z.boolean().optional(),
  isNumeric: z.boolean().optional(),
  numericFromRange: z.union([z.number(), z.null()]).optional(),
  numericToRange: z.union([z.number(), z.null()]).optional(),
  numericIncrement: z.union([z.number(), z.null()]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  // Reject renames that would create a logical duplicate of another row
  // (e.g. renaming attr A to "Sizes" when attr B is already "Size"). The
  // POST endpoint enforces the same rule on create; without this guard,
  // an admin could side-step it by renaming after the fact.
  if (body.name !== undefined) {
    const normalisedIncoming = normalizeAttributeName(body.name);
    const allRows = await db
      .select({ id: productAttributes.id, name: productAttributes.name })
      .from(productAttributes);
    const clash = allRows.find(
      (r) =>
        r.id !== id &&
        normalizeAttributeName(r.name) === normalisedIncoming,
    );
    if (clash) {
      return NextResponse.json(
        {
          error: `Another attribute named "${clash.name}" already exists (logically equivalent to "${body.name}"). Rename or delete it first.`,
          conflictingAttribute: clash,
        },
        { status: 409 },
      );
    }
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    // Drizzle numeric columns serialize from string; coerce here so the UI
    // can pass plain numbers.
    if (
      (k === "numericFromRange" ||
        k === "numericToRange" ||
        k === "numericIncrement") &&
      typeof v === "number"
    ) {
      update[k] = String(v);
    } else {
      update[k] = v;
    }
  }
  const [beforeRow] = await db
    .select()
    .from(productAttributes)
    .where(eq(productAttributes.id, id))
    .limit(1);
  await db.update(productAttributes).set(update).where(eq(productAttributes.id, id));
  // Attribute name / metadata appears in cached product DTOs
  // (attributeGroups[].name). Bust both shop caches so renames land live.
  await invalidateCatalog();

  // Exclude the bookkeeping `updatedAt` from the diff so it doesn't show as a
  // change on every edit.
  const { updatedAt: _ignore, ...afterForDiff } = update;
  const changes = diffFields(
    (beforeRow ?? {}) as unknown as Record<string, unknown>,
    afterForDiff,
    {
      name: "Name",
      type: "Type",
      description: "Description",
      sortOrder: "Sort Order",
      isDisabled: "Disabled",
      isNumeric: "Numeric",
      numericFromRange: "Numeric From",
      numericToRange: "Numeric To",
      numericIncrement: "Numeric Increment",
    }
  );
  if (changes.length > 0) {
    void logAdminActivity(guard, {
      action: "attribute.update",
      entityType: "attribute",
      entityId: id,
      summary: `Updated ${changes.map((c) => c.label ?? c.field).join(", ")}`,
      changes,
      req,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [beforeDelete] = await db
    .select({ name: productAttributes.name })
    .from(productAttributes)
    .where(eq(productAttributes.id, id))
    .limit(1);
  await db.delete(productAttributes).where(eq(productAttributes.id, id));
  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "attribute.delete",
    entityType: "attribute",
    entityId: id,
    summary: `Deleted attribute ${beforeDelete?.name ?? id}`,
    req,
  });

  return NextResponse.json({ ok: true });
}
