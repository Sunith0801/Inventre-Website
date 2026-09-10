import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { discountRules } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { logAdminActivity, diffFields } from "@/server/activity";

const Body = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  isStackable: z.boolean().optional(),
  priority: z.number().int().optional(),
  value: z.number().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("discounts.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (k === "value" && typeof v === "number") update[k] = v.toString();
    else if (k === "validFrom" || k === "validUntil") update[k] = v ? new Date(v as string) : null;
    else update[k] = v;
  }
  const [before] = await db
    .select()
    .from(discountRules)
    .where(eq(discountRules.id, id))
    .limit(1);
  await db.update(discountRules).set(update).where(eq(discountRules.id, id));
  if (before) {
    const after = { ...update };
    delete after.updatedAt;
    const changes = diffFields(
      before as unknown as Record<string, unknown>,
      after,
      {
        name: "Name",
        isActive: "Active",
        isStackable: "Stackable",
        priority: "Priority",
        value: "Value",
        validFrom: "Valid From",
        validUntil: "Valid Until",
      }
    );
    if (changes.length > 0) {
      void logAdminActivity(guard, {
        action: "discount.update",
        entityType: "discount",
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
  const guard = await requirePermission("discounts.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const [before] = await db
    .select()
    .from(discountRules)
    .where(eq(discountRules.id, id))
    .limit(1);
  await db.delete(discountRules).where(eq(discountRules.id, id));
  void logAdminActivity(guard, {
    action: "discount.delete",
    entityType: "discount",
    entityId: id,
    summary: `Deleted discount ${before?.name ?? id}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
