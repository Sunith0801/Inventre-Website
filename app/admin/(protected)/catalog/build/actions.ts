"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireAnyPermission, isResponse } from "@/server/admin-guard";
import { invalidateCatalog } from "@/server/cache";
import { logActivity } from "@/server/activity";
import {
  createBookkitWithBom,
  createUniformWithVariants,
  type BookkitChildPayload,
  type BookkitPayload,
  type UniformPayload,
} from "@/server/admin/catalog-builders";

// Zod schemas — mirror the TS types in catalog-builders.ts but enforce
// runtime shape (the client sends untrusted JSON).
//
// Note: z.discriminatedUnion requires ZodObject members (not generic
// ZodType), so we build the leaf / existing branches as concrete objects
// and define BookkitChild as a recursive ZodType for the sub-bundle case
// — Zod v3 doesn't yet support recursive discriminatedUnion, so we use
// the discriminator manually via `z.union` with the recursive branch.
const LeafChild = z.object({
  kind: z.literal("new_leaf"),
  name: z.string().min(1),
  slug: z.string().optional(),
  basePrice: z.number().min(0),
  productKind: z.enum(["book", "consumable", "accessory"]),
  categoryId: z.string().uuid().nullable().optional(),
  qty: z.number().int().min(1).max(99),
  isOptional: z.boolean().optional(),
});
const ExistingChild = z.object({
  kind: z.literal("existing"),
  productId: z.string().uuid(),
  qty: z.number().int().min(1).max(99),
  isOptional: z.boolean().optional(),
});
const BookkitChild: z.ZodType<BookkitChildPayload> = z.lazy(() =>
  z.union([
    LeafChild,
    ExistingChild,
    z.object({
      kind: z.literal("new_sub_bundle"),
      name: z.string().min(1),
      slug: z.string().optional(),
      basePrice: z.number().min(0),
      categoryId: z.string().uuid().nullable().optional(),
      children: z.array(BookkitChild),
      qty: z.number().int().min(1).max(99),
      isOptional: z.boolean().optional(),
    }),
  ]),
);

// Shared axis + variant shapes — also used by the Uniform input below.
const SharedAxisInput = z.object({
  attributeId: z.string().uuid(),
  attributeName: z.string().min(1),
  values: z
    .array(
      z.object({
        valueId: z.string().uuid(),
        label: z.string().min(1),
      }),
    )
    .min(1),
});
const SharedVariantInput = z.object({
  axisValueIds: z.array(z.string().uuid()).min(1),
  sizeLabel: z.string().min(1),
  sku: z.string().min(1),
  stockQty: z.number().int().min(0),
  isActive: z.boolean(),
});

const BookkitInput = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  basePrice: z.number().min(0),
  baseMrp: z.number().min(0).nullable().optional(),
  status: z.enum(["active", "draft", "archived"]),
  schoolIds: z.array(z.string().uuid()),
  grades: z.array(z.string().min(1)),
  children: z.array(BookkitChild),
  languageVariants: z
    .array(
      z.object({
        secondLang: z.string().min(1),
        thirdLang: z.string().nullable().optional(),
        sku: z.string().optional(),
      }),
    )
    .optional(),
  // Sibling-kit-per-combo wiring. When present, the builder writes one
  // sibling product per language combo (kind=kit, variant_of_product_id =
  // template, is_variant_item=true) with its own product_bundles +
  // bundle_components. Combo key shape is `${secondLang}||${thirdLang}`,
  // where thirdLang is "" when only a 2nd language is selected.
  languageCombos: z
    .object({
      bomByCombo: z.record(z.string(), z.array(BookkitChild)).optional(),
      // Prices in PAISE (integer). Combos absent here fall back to the
      // template's basePrice via the storefront variant resolver.
      pricesByCombo: z.record(z.string(), z.number().int().min(0)).optional(),
    })
    .optional(),
  multiAxis: z
    .union([
      z.object({
        mode: z.literal("flat"),
        axes: z.array(SharedAxisInput).min(1),
        variants: z.array(SharedVariantInput).min(1),
      }),
      z.object({
        mode: z.literal("guidedStreams"),
        streams: z.array(z.string().min(1)).max(7).optional(),
        languages: z.array(z.string().min(1)).max(7).optional(),
        mandatesPerStream: z.record(z.string().min(1), z.array(BookkitChild)).optional(),
        // Combo-keyed value lists. Key shape is `${stream}||${language}`
        // (each side empty when the matching axis is disabled). Values
        // are plain labels — the builder dedupes + maps to product_
        // attribute_values rows transactionally.
        elective1: z.record(z.string(), z.array(z.string().min(1))).optional(),
        elective2: z.record(z.string(), z.array(z.string().min(1))).optional(),
        // Per-combo price override in PAISE. Key shape is
        // `${stream}||${language}||${elective1}||${elective2}` with empty
        // string for each disabled axis. Combos not present here fall back
        // to the parent product's basePrice via the storefront resolver.
        pricesByCombo: z.record(z.string(), z.number().int().min(0)).optional(),
      }),
    ])
    .optional(),
});

export type CreateBookkitResponse =
  | { ok: true; productId: string; childCount: number; variantCount: number }
  | { ok: false; error: string };

/**
 * Server action invoked by the Bookkit wizard's final "Create" button.
 * Validates, runs the transactional builder, invalidates the storefront
 * catalog cache, writes an audit log entry, and returns the new
 * productId so the client can redirect to its edit page.
 */
export async function createBookkitAction(
  raw: unknown,
): Promise<CreateBookkitResponse> {
  const guard = await requireAnyPermission("catalog-build.write", "catalog.write");
  if (isResponse(guard)) return { ok: false, error: "Unauthorized" };

  const parsed = BookkitInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  const payload: BookkitPayload = parsed.data;

  try {
    const result = await createBookkitWithBom(payload);

    await logActivity({
      actorId: guard.id,
      actorEmail: guard.email,
      action: "catalog.bookkit.create",
      entityType: "product",
      entityId: result.productId,
      summary: `Created Bookkit "${payload.name}" (${result.childProductIds.length} children, ${result.variantIds.length} language variants)`,
      diff: {
        schoolIds: payload.schoolIds,
        grades: payload.grades,
        children: payload.children.length,
      },
    });

    await invalidateCatalog();
    revalidatePath("/admin/products");
    revalidatePath("/admin/boms");

    return {
      ok: true,
      productId: result.productId,
      childCount: result.childProductIds.length,
      variantCount: result.variantIds.length,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// ───────────────────────── uniform ─────────────────────────

const UniformInput = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  basePrice: z.number().min(0),
  baseMrp: z.number().min(0).nullable().optional(),
  status: z.enum(["active", "draft", "archived"]),
  schoolIds: z.array(z.string().uuid()).default([]),
  grades: z.array(z.string().min(1)).default([]),
  axes: z.array(SharedAxisInput).min(1),
  variants: z.array(SharedVariantInput).min(1),
  kind: z.enum(["uniform", "kit", "accessory"]).optional(),
});

export type CreateUniformResponse =
  | { ok: true; productId: string; variantCount: number }
  | { ok: false; error: string };

export async function createUniformAction(
  raw: unknown,
): Promise<CreateUniformResponse> {
  const guard = await requireAnyPermission("catalog-build.write", "catalog.write");
  if (isResponse(guard)) return { ok: false, error: "Unauthorized" };

  const parsed = UniformInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  const payload: UniformPayload = parsed.data;

  try {
    const result = await createUniformWithVariants(payload);
    await logActivity({
      actorId: guard.id,
      actorEmail: guard.email,
      action: "catalog.uniform.create",
      entityType: "product",
      entityId: result.productId,
      summary: `Created Uniform "${payload.name}" (${result.variantIds.length} variants across ${payload.axes.length} axes)`,
      diff: {
        schoolIds: payload.schoolIds,
        grades: payload.grades,
        axes: payload.axes.map((a) => a.attributeName),
        variantCount: payload.variants.length,
      },
    });
    await invalidateCatalog();
    revalidatePath("/admin/products");
    return { ok: true, productId: result.productId, variantCount: result.variantIds.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}
