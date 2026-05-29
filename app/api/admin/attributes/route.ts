import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { productAttributes, productAttributeValues } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { eq } from "drizzle-orm";

const Body = z.object({
  name: z.string().min(1),
  type: z.enum(["size", "color", "design", "model", "other"]),
  schoolId: z.string().uuid().nullable().optional(),
  description: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

export async function GET() {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const rows = await db.select().from(productAttributes);
  return NextResponse.json({ attributes: rows });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("super");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const [created] = await db
    .insert(productAttributes)
    .values({
      name: body.name,
      type: body.type,
      schoolId: body.schoolId ?? null,
      description: body.description ?? null,
      sortOrder: body.sortOrder,
    })
    .returning();
  return NextResponse.json({ attribute: created });
}
