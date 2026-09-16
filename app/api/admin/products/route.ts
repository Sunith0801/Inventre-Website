import { NextResponse } from "next/server";
import { parseBody } from "@/server/parse-body";
import { z } from "zod";
import { eq, and, or, ilike, asc, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  products,
  productVariants,
  productSchool,
  productGrades,
  productBundles,
} from "@/db/schema";
import { isResponse, requirePermission, requireAnyPermission } from "@/server/admin-guard";
import { invalidateCatalog } from "@/server/cache";
import { buildQrPayload, renderQrSvg } from "@/lib/qr";
import { logAdminActivity } from "@/server/activity";

export async function GET(req: Request) {
  const guard = await requireAnyPermission("products.read", "catalog.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const schoolId = url.searchParams.get("schoolId") ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10), 500);

  const conds = [];
  if (q) {
    conds.push(
      or(
        ilike(products.name, `%${q}%`),
        ilike(products.slug, `%${q}%`),
        ilike(sql`COALESCE(${products.itemCode}, '')`, `%${q}%`)
      )!
    );
  }
  // school_admin always scoped to their school
  const effectiveSchool =
    guard.role === "school_admin" ? guard.schoolId ?? null : schoolId ?? null;
  if (guard.role === "school_admin" && !guard.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // If a school filter is in play, only return products bound to that school.
  let productRows: (typeof products.$inferSelect)[];
  if (effectiveSchool) {
    productRows = await db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        tagline: products.tagline,
        basePrice: products.basePrice,
        baseMrp: products.baseMrp,
        status: products.status,
        categoryId: products.categoryId,
        itemCode: products.itemCode,
        hsnCode: products.hsnCode,
        gstTreatment: products.gstTreatment,
        brand: products.brand,
        weightGrams: products.weightGrams,
        dimensions: products.dimensions,
        minOrderQty: products.minOrderQty,
        reorderTatDays: products.reorderTatDays,
        costPrice: products.costPrice,
        displayPrice: products.displayPrice,
        gstInclusive: products.gstInclusive,
        categoryFixedMarginPercent: products.categoryFixedMarginPercent,
        customerDiscountPercent: products.customerDiscountPercent,
        organizationMarginPercent: products.organizationMarginPercent,
        suggestedOrgPrice: products.suggestedOrgPrice,
        agreedOrgPrice: products.agreedOrgPrice,
        organizationMrp: products.organizationMrp,
        isMagicBox: products.isMagicBox,
        weightPerUnit: products.weightPerUnit,
        qrCodeData: products.qrCodeData,
        qrCodeSvg: products.qrCodeSvg,
        createdAt: products.createdAt,
      })
      .from(products)
      .innerJoin(productSchool, eq(productSchool.productId, products.id))
      .where(
        and(eq(productSchool.schoolId, effectiveSchool), ...(conds.length ? conds : []))
      )
      .orderBy(asc(products.name))
      .limit(limit) as never;
  } else {
    productRows = await db
      .select()
      .from(products)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(products.name))
      .limit(limit);
  }

  // Attach variants
  const ids = productRows.map((p) => p.id);
  const variants = ids.length
    ? await db
        .select({
          id: productVariants.id,
          productId: productVariants.productId,
          size: productVariants.size,
          sku: productVariants.sku,
          stockQty: productVariants.stockQty,
        })
        .from(productVariants)
        .where(inArray(productVariants.productId, ids))
    : [];
  const variantsByProduct = new Map<string, typeof variants>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.productId) ?? [];
    arr.push(v);
    variantsByProduct.set(v.productId, arr);
  }

  return NextResponse.json({
    products: productRows.map((p) => ({
      ...p,
      variants: variantsByProduct.get(p.id) ?? [],
    })),
  });
}

/**
 * Catalog-role taxonomy admins pick on the create form. Drives storefront
 * visibility (see lib/repos/products.ts:listProductsForStudent). Default
 * `'book'` matches the DB column default — pre-Phase-1 rows aren't
 * touched.
 */
const KindEnum = z.enum([
  "magic_box",
  "kit",
  "sub_bundle",
  "uniform",
  "accessory",
  "book",
  "consumable",
  "excluded",
]);
const BUNDLE_KINDS = new Set(["magic_box", "kit", "sub_bundle"]);

const Body = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  tagline: z.string().optional(),
  // School + grade mapping to apply on creation. Single forms send
  // `schoolId` / `grade`; the wizard / multi-select form may instead
  // send `schoolIds` / `grades` arrays. Both shapes are accepted so
  // legacy callers keep working.
  schoolId: z.string().uuid().nullable().optional(),
  schoolIds: z.array(z.string().uuid()).optional(),
  grade: z.string().nullable().optional(),
  grades: z.array(z.string().min(1)).optional(),
  kind: KindEnum.optional(),
  basePrice: z.number().int().min(0),
  baseMrp: z.number().int().min(0).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "archived"]),
  // Phase 1 fields
  itemCode: z.string().optional(),
  hsnCode: z.string().optional(),
  gstTreatment: z.enum(["taxable", "nil_rated", "exempt", "non_gst", "zero_rated"]).optional(),
  brand: z.string().optional(),
  weightGrams: z.number().int().optional(),
  dimensions: z.object({ l: z.number(), w: z.number(), h: z.number() }).optional(),
  minOrderQty: z.number().int().min(1).optional(),
  reorderTatDays: z.number().int().optional(),
  costPrice: z.number().int().optional(),
  displayPrice: z.number().int().optional(),
  // Gap-fix fields (audit §2.3)
  gstInclusive: z.boolean().optional(),
  categoryFixedMarginPercent: z.number().optional(),
  customerDiscountPercent: z.number().optional(),
  organizationMarginPercent: z.number().optional(),
  suggestedOrgPrice: z.number().int().optional(),
  agreedOrgPrice: z.number().int().optional(),
  organizationMrp: z.number().int().optional(),
  isMagicBox: z.boolean().optional(),
  weightPerUnit: z.number().optional(),
  // Product creation redesign: uniform type + pricing-step fields.
  bundleGender: z.enum(["Boys", "Girls"]).nullable().optional(),
  gstRate: z.number().min(0).max(100).nullable().optional(),
  priceEffectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAnyPermission("products.write", "catalog.write");
  if (isResponse(guard)) return guard;
  const parsed = await parseBody(req, Body);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  const [created] = await db
    .insert(products)
    .values({
      name: body.name,
      slug: body.slug,
      tagline: body.tagline || null,
      basePrice: body.basePrice * 100,
      baseMrp: body.baseMrp != null ? body.baseMrp * 100 : null,
      categoryId: body.categoryId || null,
      status: body.status,
      itemCode: body.itemCode ?? null,
      hsnCode: body.hsnCode ?? null,
      gstTreatment: body.gstTreatment ?? "taxable",
      brand: body.brand ?? null,
      weightGrams: body.weightGrams ?? null,
      dimensions: body.dimensions ?? null,
      minOrderQty: body.minOrderQty ?? 1,
      reorderTatDays: body.reorderTatDays ?? null,
      costPrice: body.costPrice ?? null,
      displayPrice: body.displayPrice ?? null,
      gstInclusive: body.gstInclusive ?? true,
      categoryFixedMarginPercent: body.categoryFixedMarginPercent != null ? body.categoryFixedMarginPercent.toString() : null,
      customerDiscountPercent: body.customerDiscountPercent != null ? body.customerDiscountPercent.toString() : null,
      organizationMarginPercent: body.organizationMarginPercent != null ? body.organizationMarginPercent.toString() : null,
      suggestedOrgPrice: body.suggestedOrgPrice ?? null,
      agreedOrgPrice: body.agreedOrgPrice ?? null,
      organizationMrp: body.organizationMrp ?? null,
      isMagicBox: body.isMagicBox ?? body.kind === "magic_box",
      kind: body.kind ?? "book",
      bundleGender: body.bundleGender ?? null,
      gstRate: body.gstRate != null ? String(body.gstRate) : null,
      priceEffectiveFrom: body.priceEffectiveFrom ?? null,
      weightPerUnit: body.weightPerUnit != null ? body.weightPerUnit.toString() : null,
    })
    .returning();

  // Auto-generate QR code if itemCode is provided
  if (body.itemCode) {
    const payload = buildQrPayload({
      itemCode: body.itemCode,
      itemName: body.name,
      weightGrams: body.weightGrams,
      dimensions: body.dimensions ?? null,
    });
    await db
      .update(products)
      .set({ qrCodeData: payload, qrCodeSvg: renderQrSvg(payload) })
      .where(eq(products.id, created.id));
  }

  // Map the new item to its schools + grades. Accept both legacy
  // single-value (schoolId / grade) and the multi-select arrays
  // (schoolIds / grades) the new create form sends.
  const schoolIds = Array.from(
    new Set([
      ...(body.schoolIds ?? []),
      ...(body.schoolId ? [body.schoolId] : []),
    ])
  );
  if (schoolIds.length > 0) {
    await db
      .insert(productSchool)
      .values(schoolIds.map((schoolId) => ({ productId: created.id, schoolId })))
      .onConflictDoNothing();
  }
  const grades = Array.from(
    new Set([
      ...(body.grades ?? []),
      ...(body.grade ? [body.grade] : []),
    ])
  );
  if (grades.length > 0) {
    await db
      .insert(productGrades)
      .values(grades.map((grade) => ({ productId: created.id, grade })))
      .onConflictDoNothing();
  }

  // For bundle-type kinds (kit / magic_box / sub_bundle), seed a
  // product_bundles row so the admin can hop straight to /admin/boms
  // and add children. We use bundleType='fixed' because all current
  // bundle behaviour (Magic Box configurator, BOM tree) routes through
  // bundle_components — `configurable` is reserved for selector groups
  // that we don't author via this form.
  if (body.kind && BUNDLE_KINDS.has(body.kind)) {
    await db
      .insert(productBundles)
      .values({ productId: created.id, bundleType: "fixed" })
      .onConflictDoNothing();
  }

  await invalidateCatalog();

  void logAdminActivity(guard, {
    action: "product.create",
    entityType: "product",
    entityId: created.id,
    summary: `Created product ${created.name}`,
    req,
  });

  return NextResponse.json({ product: created });
}
