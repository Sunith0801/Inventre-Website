import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  productVariants,
  products,
  productVariantAttributes,
  productAttributes,
  productAttributeValues,
} from "@/db/schema";

/**
 * Server-side helper that loads everything the exchange form needs to
 * render a clear "what did you get / what do you want" UI:
 *
 *   • The original variant + its full axis values (Size, Language, Color,
 *     whatever the product is bound to).
 *   • All active sibling variants of the same product (so the
 *     wrong-size picker can show real options).
 *   • Each sibling's own axis values + availability flag.
 *
 * Returns null when the variant id doesn't resolve — caller should
 * 404 in that case (matches the existing exchange/new page contract).
 */

export type VariantAxis = {
  attributeId: string;
  attributeName: string;
  valueId: string;
  value: string;
};

export type VariantContext = {
  variant: {
    id: string;
    productId: string;
    productName: string;
    size: string;
    sku: string;
    imageUrl: string | null;
    isActive: boolean;
  };
  /** products.kind — drives catalog-aware reason options in the exchange form. */
  productKind: string;
  axes: VariantAxis[];
  siblings: {
    id: string;
    size: string;
    sku: string;
    imageUrl: string | null;
    isActive: boolean;
    stockQty: number;
    axes: VariantAxis[];
  }[];
};

export async function getVariantContext(
  variantId: string
): Promise<VariantContext | null> {
  const [head] = await db
    .select({
      variant: productVariants,
      product: products,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, variantId))
    .limit(1);
  if (!head) return null;

  // Pull every variant under this product (active or not — we'll let
  // the caller decide whether to render archived as picker options).
  const siblings = await db
    .select({
      variant: productVariants,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, head.product.id));

  // Bulk-fetch attribute values for the head + every sibling in one go.
  const allIds = siblings.map((s) => s.variant.id);
  const attrRows = allIds.length > 0
    ? await db
        .select({
          variantId: productVariantAttributes.variantId,
          attributeId: productAttributes.id,
          attributeName: productAttributes.name,
          valueId: productAttributeValues.id,
          value: productAttributeValues.value,
        })
        .from(productVariantAttributes)
        .innerJoin(
          productAttributes,
          eq(productAttributes.id, productVariantAttributes.attributeId)
        )
        .innerJoin(
          productAttributeValues,
          eq(productAttributeValues.id, productVariantAttributes.valueId)
        )
        .where(inArray(productVariantAttributes.variantId, allIds))
    : [];

  const axesByVariant = new Map<string, VariantAxis[]>();
  for (const r of attrRows) {
    const arr = axesByVariant.get(r.variantId) ?? [];
    arr.push({
      attributeId: r.attributeId,
      attributeName: r.attributeName,
      valueId: r.valueId,
      value: r.value,
    });
    axesByVariant.set(r.variantId, arr);
  }

  const headAxes = axesByVariant.get(head.variant.id) ?? [];
  const siblingList = siblings
    .filter((s) => s.variant.id !== head.variant.id)
    .map((s) => ({
      id: s.variant.id,
      size: s.variant.size,
      sku: s.variant.sku,
      imageUrl: s.variant.imageUrl ?? head.variant.imageUrl ?? null,
      isActive: s.variant.isActive,
      stockQty: s.variant.stockQty,
      axes: axesByVariant.get(s.variant.id) ?? [],
    }));

  return {
    variant: {
      id: head.variant.id,
      productId: head.product.id,
      productName: head.product.name,
      size: head.variant.size,
      sku: head.variant.sku,
      imageUrl: head.variant.imageUrl,
      isActive: head.variant.isActive,
    },
    productKind: head.product.kind ?? "other",
    axes: headAxes,
    siblings: siblingList,
  };
}

/**
 * Short "Size M · Hindi · Boys" string for compact rendering — works
 * over any axis set. Falls back to bare size when the variant has no
 * configured axes (legacy rows).
 */
export function formatAxisLabel(
  size: string | null | undefined,
  axes: VariantAxis[]
): string {
  if (axes.length === 0) return size ? `Size ${size}` : "Standard";
  return axes
    .slice()
    .sort((a, b) => a.attributeName.localeCompare(b.attributeName))
    .map((a) => a.value)
    .join(" · ");
}
