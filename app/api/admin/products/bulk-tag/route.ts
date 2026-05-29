import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { productSchool, productGrades, products, schools } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { parseJson } from "@/lib/api-handler";
import { invalidateCatalog } from "@/lib/cache";

/**
 * Bulk-tag a set of products to a single (school, grade) tuple.
 *
 * For each row this upserts into product_school (productId, schoolId,
 * isRequired, overridePrice) AND product_grades (productId, grade). A
 * product that's already tagged to the school keeps its existing
 * product_school row updated (isRequired / overridePrice from the
 * payload), and the product_grades row is added if missing.
 *
 * Designed to be idempotent: re-submitting the same payload returns
 * { tagged: 0, alreadyTagged: N }.
 *
 * Why not a generic upsert helper? The two tables have different unique
 * keys (product_school: (productId, schoolId); product_grades:
 * (productId, grade) — no schoolId). Keeping the logic explicit avoids
 * surprises with ON CONFLICT.
 */
const Body = z.object({
  schoolId: z.string().uuid(),
  grade: z.string().min(1),
  rows: z
    .array(
      z.object({
        productId: z.string().uuid(),
        /** When true the product appears with a "Required" badge to parents
         *  at this school. Defaults to false. */
        isRequired: z.boolean().default(false),
        /** Per-school price override in PAISE (integer). null/undefined =
         *  use the product's base price for this school. */
        overridePricePaise: z.number().int().nonnegative().nullable().optional(),
        /** Per-school MRP override in PAISE — drives storefront strike-through. */
        overrideMrpPaise: z.number().int().nonnegative().nullable().optional(),
      })
    )
    .min(1)
    .max(200),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;

  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  const productIds = body.rows.map((r) => r.productId);

  // Pre-validate references before the transaction so a bad ID returns a
  // useful 400 instead of bubbling Postgres FK error to a 500.
  const [schoolExists] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.id, body.schoolId))
    .limit(1);
  if (!schoolExists) {
    return NextResponse.json({ error: "School not found" }, { status: 400 });
  }
  const foundProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, productIds));
  if (foundProducts.length !== productIds.length) {
    const found = new Set(foundProducts.map((r) => r.id));
    const missing = productIds.filter((id) => !found.has(id));
    return NextResponse.json(
      { error: "Unknown productId(s)", missing },
      { status: 400 }
    );
  }

  // Single transaction: either the school binding upserts AND the grade rows
  // land together, or nothing does. Avoids the "half-tagged" state where the
  // product is visible to the school but not at the chosen grade (or vice
  // versa) after a mid-request failure.
  const result = await db.transaction(async (tx) => {
    const existingSchoolBindings = await tx
      .select({
        id: productSchool.id,
        productId: productSchool.productId,
      })
      .from(productSchool)
      .where(
        and(
          eq(productSchool.schoolId, body.schoolId),
          inArray(productSchool.productId, productIds)
        )
      );

    const existingByProduct = new Map(
      existingSchoolBindings.map((r) => [r.productId, r.id])
    );

    for (const r of body.rows) {
      const existingId = existingByProduct.get(r.productId);
      if (existingId) {
        await tx
          .update(productSchool)
          .set({
            isRequired: r.isRequired,
            overridePrice: r.overridePricePaise ?? null,
            overrideMrp: r.overrideMrpPaise ?? null,
          })
          .where(eq(productSchool.id, existingId));
      } else {
        await tx.insert(productSchool).values({
          productId: r.productId,
          schoolId: body.schoolId,
          isRequired: r.isRequired,
          overridePrice: r.overridePricePaise ?? null,
          overrideMrp: r.overrideMrpPaise ?? null,
        });
      }
    }

    const existingGradeRows = await tx
      .select({ productId: productGrades.productId })
      .from(productGrades)
      .where(
        and(
          inArray(productGrades.productId, productIds),
          eq(productGrades.grade, body.grade)
        )
      );
    const alreadyAtGrade = new Set(existingGradeRows.map((r) => r.productId));

    const freshGradeRows = productIds
      .filter((id) => !alreadyAtGrade.has(id))
      .map((productId) => ({ productId, grade: body.grade }));

    if (freshGradeRows.length > 0) {
      await tx.insert(productGrades).values(freshGradeRows);
    }

    return {
      tagged: body.rows.length - existingByProduct.size,
      updated: existingByProduct.size,
      gradeRowsAdded: freshGradeRows.length,
    };
  });

  // Cache invalidation runs after commit — busting before commit would
  // race with the in-flight writes and repopulate the cache from stale data.
  await invalidateCatalog();

  return NextResponse.json({ ok: true, ...result });
}

/**
 * Untag products from a (school, grade): removes their product_school
 * binding for this school AND their product_grades row for this grade
 * IFF no other school still references that product at the same grade.
 *
 * product_grades has no schoolId column, so a tag at grade X is shared
 * across every school that wires the product up. We only drop the
 * product_grades row when removing this school would leave it orphaned.
 */
const UntagBody = z.object({
  schoolId: z.string().uuid(),
  grade: z.string().min(1),
  productIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function DELETE(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;

  const body = await parseJson(req, UntagBody);
  if (body instanceof NextResponse) return body;

  const result = await db.transaction(async (tx) => {
    const removedSchool = await tx
      .delete(productSchool)
      .where(
        and(
          eq(productSchool.schoolId, body.schoolId),
          inArray(productSchool.productId, body.productIds)
        )
      )
      .returning({ productId: productSchool.productId });

    const removedIds = removedSchool.map((r) => r.productId);
    if (removedIds.length === 0) return { untagged: 0, gradeRowsRemoved: 0 };

    // For each removed product, drop the grade row only if no other school
    // still binds the product. Otherwise it stays — other schools may still
    // ship the same product at this grade.
    const stillReferenced = await tx
      .select({ productId: productSchool.productId })
      .from(productSchool)
      .where(inArray(productSchool.productId, removedIds));
    const stillRefSet = new Set(stillReferenced.map((r) => r.productId));
    const orphanedIds = removedIds.filter((id) => !stillRefSet.has(id));

    let gradeRowsRemoved = 0;
    if (orphanedIds.length > 0) {
      const gone = await tx
        .delete(productGrades)
        .where(
          and(
            eq(productGrades.grade, body.grade),
            inArray(productGrades.productId, orphanedIds)
          )
        )
        .returning({ productId: productGrades.productId });
      gradeRowsRemoved = gone.length;
    }

    return { untagged: removedIds.length, gradeRowsRemoved };
  });

  await invalidateCatalog();

  return NextResponse.json({ ok: true, ...result });
}
