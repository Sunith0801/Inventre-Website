import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import {
  products,
  productBundles,
  bundleComponents,
  productSchool,
  productGrades,
} from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { invalidateCatalog } from "@/lib/cache";

/** Existing BOM components for a product — for prefilling the BOM form. */
export async function GET(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;
  const productId = new URL(req.url).searchParams.get("productId");
  if (!productId) return NextResponse.json({ components: [] });
  const comp = alias(products, "bom_get_comp");
  const rows = await db
    .select({ code: comp.itemCode, qty: bundleComponents.qty })
    .from(productBundles)
    .innerJoin(
      bundleComponents,
      eq(bundleComponents.bundleId, productBundles.id)
    )
    .innerJoin(comp, eq(comp.id, bundleComponents.productId))
    .where(eq(productBundles.productId, productId));
  return NextResponse.json({ components: rows });
}

const Body = z.object({
  productId: z.string().uuid(),
  schoolId: z.string().uuid().optional(),
  grade: z.string().optional(),
  components: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().int().min(1),
      })
    )
    .min(1),
});

/**
 * Create / replace a BOM for a kit product.
 * Upserts product_bundles, replaces bundle_components, and ensures the kit
 * product is mapped to the chosen school + grade.
 */
export async function POST(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let [bundle] = await db
    .select()
    .from(productBundles)
    .where(eq(productBundles.productId, body.productId))
    .limit(1);
  if (!bundle) {
    [bundle] = await db
      .insert(productBundles)
      .values({ productId: body.productId, bundleType: "fixed" })
      .returning();
  }

  await db
    .delete(bundleComponents)
    .where(eq(bundleComponents.bundleId, bundle.id));
  await db.insert(bundleComponents).values(
    body.components.map((c) => ({
      bundleId: bundle.id,
      productId: c.productId,
      qty: c.qty,
    }))
  );

  if (body.schoolId) {
    await db
      .insert(productSchool)
      .values({ productId: body.productId, schoolId: body.schoolId })
      .onConflictDoNothing();
  }
  if (body.grade) {
    await db
      .insert(productGrades)
      .values({ productId: body.productId, grade: body.grade })
      .onConflictDoNothing();
  }

  await invalidateCatalog();
  return NextResponse.json({ ok: true, bundleId: bundle.id });
}
