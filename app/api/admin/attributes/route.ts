import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { productAttributes } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { eq, sql } from "drizzle-orm";

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

  // Pre-check the unique-name index so we can return a structured 409
  // instead of a 500 from the constraint violation. The wizard's
  // AttributeAdder consumes the body to silently fall back to the
  // existing attribute (with its values) — same outcome as if the admin
  // had picked it from the dropdown.
  const [existing] = await db
    .select({ id: productAttributes.id, name: productAttributes.name, type: productAttributes.type })
    .from(productAttributes)
    .where(eq(sql`lower(${productAttributes.name})`, body.name.trim().toLowerCase()))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      {
        error: `An attribute named "${existing.name}" already exists. Reusing it instead of creating a duplicate.`,
        existing,
      },
      { status: 409 },
    );
  }

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
