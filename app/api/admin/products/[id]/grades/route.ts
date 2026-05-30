import { NextResponse } from "next/server";
import { parseBody } from "@/lib/parse-body";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { productGrades } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";

const Body = z.object({
  grades: z.array(z.string().min(1)),
  isOrganization: z.boolean().default(false),
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
    .from(productGrades)
    .where(eq(productGrades.productId, id));
  return NextResponse.json({ grades: rows });
}

/**
 * Replace-mode: provided grades fully replace existing grade rows for this product.
 * Pass an empty array to clear all grade restrictions (product becomes "all grades").
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission("catalog.write");
  if (isResponse(guard)) return guard;
  const { id } = await params;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  await db.transaction(async (tx) => {
    await tx.delete(productGrades).where(eq(productGrades.productId, id));
    if (body.grades.length > 0) {
      await tx.insert(productGrades).values(
        body.grades.map((g) => ({
          productId: id,
          grade: g,
          isOrganization: body.isOrganization,
        }))
      );
    }
  });
  await invalidateCatalog();
  return NextResponse.json({ ok: true, count: body.grades.length });
}
