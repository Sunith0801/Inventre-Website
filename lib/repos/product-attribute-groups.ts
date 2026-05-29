/**
 * Recompute `products.attribute_groups` (jsonb) for a template product
 * from `product_variant_attributes`. Idempotent — safe to call after any
 * variant upsert or as a standalone backfill.
 *
 * Shape (matches the existing AttributeGroupPicker contract — see
 * components/shop/pdp/BuyBox.tsx:163-172):
 *   [ { name: string, values: string[] }, ... ]
 *
 * Group order follows `product_attribute_bindings.sortOrder`, falling back
 * to `product_attributes.sortOrder` and then attribute name. Values within
 * a group follow `product_attribute_values.sortOrder` then value text.
 *
 * Also heals `product_attribute_bindings` — any axis we see used by a
 * variant but not yet bound to the template gets inserted, so the admin
 * UI and the variant resolver stay coherent.
 */
// Intentionally NOT `import "server-only"` — this helper is shared between
// the Next.js runtime (importer routes / admin actions) and the standalone
// tsx scripts (backfill / migrate-from-erp). server-only is a Next-only
// package and breaks the script path. The DB client used here is Node-only,
// so accidental client-side import would fail anyway.
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  products,
  productAttributes,
  productAttributeValues,
  productAttributeBindings,
  productVariants,
  productVariantAttributes,
} from "@/db/schema";

export type AttributeGroupJson = { name: string; values: string[] };

/**
 * Look up the human-friendly axis name to use for the "size" group when
 * deriving `products.attribute_groups` from the legacy `product_variants.size`
 * column. Returns the name of the EAV attribute of type='size' bound to the
 * product's active variants (e.g. "Caps Sizes", "Skirt Size", "Shirt Size"),
 * or `null` if no such EAV attribute exists. Callers decide whether to fall
 * back to the legacy "Size" label or skip the size group entirely (the
 * latter prevents a phantom Size axis on products whose
 * `product_variants.size` column holds non-size labels, like the CAS
 * bookkit parents where `size` is a sibling product name).
 */
export async function getSizeAxisNameForProduct(
  productId: string
): Promise<string | null> {
  const rows = await db
    .select({ name: productAttributes.name })
    .from(productAttributes)
    .innerJoin(
      productVariantAttributes,
      eq(productVariantAttributes.attributeId, productAttributes.id)
    )
    .innerJoin(
      productVariants,
      eq(productVariants.id, productVariantAttributes.variantId)
    )
    .where(
      sql`${productVariants.productId} = ${productId} AND ${productAttributes.type}::text = 'size'`
    )
    .limit(1);
  return rows[0]?.name ?? null;
}

export async function refreshProductAttributeGroups(
  productId: string
): Promise<AttributeGroupJson[]> {
  const rows = await db
    .select({
      attributeId: productAttributes.id,
      attributeName: productAttributes.name,
      bindingSort: productAttributeBindings.sortOrder,
      attributeSort: productAttributes.sortOrder,
      value: productAttributeValues.value,
      valueSort: productAttributeValues.sortOrder,
    })
    .from(productVariantAttributes)
    .innerJoin(
      productVariants,
      eq(productVariants.id, productVariantAttributes.variantId)
    )
    .innerJoin(
      productAttributes,
      eq(productAttributes.id, productVariantAttributes.attributeId)
    )
    .innerJoin(
      productAttributeValues,
      eq(productAttributeValues.id, productVariantAttributes.valueId)
    )
    .leftJoin(
      productAttributeBindings,
      sql`${productAttributeBindings.productId} = ${productId} AND ${productAttributeBindings.attributeId} = ${productAttributes.id}`
    )
    .where(eq(productVariants.productId, productId));

  if (rows.length === 0) {
    await db
      .update(products)
      .set({ attributeGroups: null })
      .where(eq(products.id, productId));
    return [];
  }

  type Bucket = {
    attributeId: string;
    name: string;
    sortKey: number;
    valueRows: Array<{ value: string; sort: number }>;
    seen: Set<string>;
  };
  const byAttribute = new Map<string, Bucket>();
  for (const r of rows) {
    let bucket = byAttribute.get(r.attributeId);
    if (!bucket) {
      bucket = {
        attributeId: r.attributeId,
        name: r.attributeName,
        sortKey: r.bindingSort ?? r.attributeSort ?? 0,
        valueRows: [],
        seen: new Set<string>(),
      };
      byAttribute.set(r.attributeId, bucket);
    }
    if (!bucket.seen.has(r.value)) {
      bucket.seen.add(r.value);
      bucket.valueRows.push({ value: r.value, sort: r.valueSort ?? 0 });
    }
  }

  // Order axes for the PDP picker stack:
  //   1. Fixed axes first (exactly 1 value — typically the "Mandate"-style
  //      axis where there's no real choice and we want to render it as a
  //      confirmed chip before the user-driven axes).
  //   2. Then by explicit sortOrder from bindings / attribute (mostly 0 in
  //      practice today; left as a hook for future admin-set ordering).
  //   3. Then by attribute name, which gives stable cross-render order.
  const groups: AttributeGroupJson[] = Array.from(byAttribute.values())
    .sort((a, b) => {
      const aFixed = a.valueRows.length === 1 ? 0 : 1;
      const bFixed = b.valueRows.length === 1 ? 0 : 1;
      if (aFixed !== bFixed) return aFixed - bFixed;
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return a.name.localeCompare(b.name);
    })
    .map((b) => ({
      name: b.name,
      values: b.valueRows
        .sort((x, y) => x.sort - y.sort || x.value.localeCompare(y.value))
        .map((v) => v.value),
    }));

  await db
    .update(products)
    .set({ attributeGroups: groups })
    .where(eq(products.id, productId));

  // Heal bindings so admin tooling + resolver agree with what variants
  // actually use. No-op when the binding already exists.
  for (const [attributeId, bucket] of byAttribute.entries()) {
    await db
      .insert(productAttributeBindings)
      .values({
        productId,
        attributeId,
        isRequired: true,
        sortOrder: bucket.sortKey,
      })
      .onConflictDoNothing();
  }

  return groups;
}
