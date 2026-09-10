import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { db } from "@/db/client";
import { productAttributes } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { normalizeAttributeName } from "@/lib/normalize-attribute-name";
import { logAdminActivity } from "@/server/activity";

const Body = z.object({
  name: z.string().min(1),
  type: z.enum(["size", "color", "design", "model", "other"]),
  schoolId: z.string().uuid().nullable().optional(),
  description: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

export async function GET() {
  const guard = await requirePermission("catalog.read");
  if (isResponse(guard)) return guard;
  const rows = await db.select().from(productAttributes);
  return NextResponse.json({ attributes: rows });
}

export async function POST(req: Request) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  // Pre-check the unique-name index so we can return a structured 409
  // instead of a 500 from the constraint violation. The wizard's
  // AttributeAdder consumes the body to silently fall back to the
  // existing attribute (with its values) — same outcome as if the admin
  // had picked it from the dropdown.
  //
  // The check is widened beyond an exact lowercase match to catch
  // logically-equivalent names — "Size" vs "Sizes", "Colour" vs "Color".
  // Without this, both could be created as distinct rows and end up
  // bound to the same product's variants, which produced the doubled-
  // Size symptom on inventre-dev. We pull all rows once (the table is
  // small — tens to a few hundred rows) and compare in JS using the
  // shared normaliser so the rule stays in one place.
  const normalisedIncoming = normalizeAttributeName(body.name);
  const allRows = await db
    .select({ id: productAttributes.id, name: productAttributes.name, type: productAttributes.type })
    .from(productAttributes);
  const existing = allRows.find(
    (r) => normalizeAttributeName(r.name) === normalisedIncoming,
  );
  if (existing) {
    return NextResponse.json(
      {
        error: `An attribute named "${existing.name}" already exists (logically equivalent to "${body.name}"). Reusing it instead of creating a duplicate.`,
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

  void logAdminActivity(guard, {
    action: "attribute.create",
    entityType: "attribute",
    entityId: created.id,
    summary: `Created attribute ${created.name}`,
    req,
  });

  return NextResponse.json({ attribute: created });
}
