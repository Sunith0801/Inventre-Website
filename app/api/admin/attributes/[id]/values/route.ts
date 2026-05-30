import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productAttributeValues } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";

const Body = z.object({
  value: z.string().min(1),
  shortCode: z.string().optional(),
  displayLabel: z.string().optional(),
  hexColor: z.string().optional(),
  imageUrl: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.read");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const rows = await db
    .select()
    .from(productAttributeValues)
    .where(eq(productAttributeValues.attributeId, id));
  return NextResponse.json({ values: rows });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const [created] = await db
    .insert(productAttributeValues)
    .values({
      attributeId: id,
      value: body.value,
      shortCode: body.shortCode ?? null,
      displayLabel: body.displayLabel ?? null,
      hexColor: body.hexColor ?? null,
      imageUrl: body.imageUrl ?? null,
      sortOrder: body.sortOrder,
    })
    .returning();
  return NextResponse.json({ value: created });
}
