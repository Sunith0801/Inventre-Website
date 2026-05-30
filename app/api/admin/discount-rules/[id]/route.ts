import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { discountRules } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";

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
  await db.update(discountRules).set(update).where(eq(discountRules.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("discounts.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  await db.delete(discountRules).where(eq(discountRules.id, id));
  return NextResponse.json({ ok: true });
}
