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
import { normalizeAttributeName } from "@/lib/normalize-attribute-name";

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

  // Bucket by the *normalised* attribute name so two rows like "Size" +
  // "Sizes" collapse into one axis. Keying by `attributeId` was the
  // historical bug — it preserved both buckets and the PDP rendered the
  // duplicate. We retain a Set of attribute IDs per bucket purely for
  // logging the collapse so admin can spot bad catalog data.
  type Bucket = {
    normalizedKey: string;
    displayName: string;
    attributeIds: Set<string>;
    sortKey: number;
    valueRows: Array<{ value: string; sort: number }>;
    seen: Set<string>;
  };
  const byNormalisedName = new Map<string, Bucket>();
  for (const r of rows) {
    const key = normalizeAttributeName(r.attributeName);
    let bucket = byNormalisedName.get(key);
    if (!bucket) {
      bucket = {
        normalizedKey: key,
        displayName: r.attributeName,
        attributeIds: new Set<string>(),
        sortKey: r.bindingSort ?? r.attributeSort ?? 0,
        valueRows: [],
        seen: new Set<string>(),
      };
      byNormalisedName.set(key, bucket);
    }
    bucket.attributeIds.add(r.attributeId);
    // Use the lowest sortKey across merged attributes so the merged axis
    // doesn't jump position when one of its rows is renamed/re-sorted.
    const thisSort = r.bindingSort ?? r.attributeSort ?? 0;
    if (thisSort < bucket.sortKey) bucket.sortKey = thisSort;
    if (!bucket.seen.has(r.value)) {
      bucket.seen.add(r.value);
      bucket.valueRows.push({ value: r.value, sort: r.valueSort ?? 0 });
    }
  }

  // Surface bad catalog data: any normalised axis backed by more than one
  // attribute row is a signal that admin has equivalent attributes (e.g.
  // "Size" + "Sizes") that should be merged into one. We keep the page
  // working — the merge above produces the correct group — but log so the
  // duplicate can be cleaned at the source.
  for (const b of byNormalisedName.values()) {
    if (b.attributeIds.size > 1) {
      console.warn(
        `[attribute-groups] product=${productId}: merged ${b.attributeIds.size} attribute rows into one '${b.displayName}' axis (normalized='${b.normalizedKey}', attribute_ids=${Array.from(b.attributeIds).join(",")})`,
      );
    }
  }

  // Order axes for the PDP picker stack:
  //   1. Fixed axes first (exactly 1 value — typically the "Mandate"-style
  //      axis where there's no real choice and we want to render it as a
  //      confirmed chip before the user-driven axes).
  //   2. Then by explicit sortOrder from bindings / attribute (mostly 0 in
  //      practice today; left as a hook for future admin-set ordering).
  //   3. Then by attribute name, which gives stable cross-render order.
  const groups: AttributeGroupJson[] = Array.from(byNormalisedName.values())
    .sort((a, b) => {
      const aFixed = a.valueRows.length === 1 ? 0 : 1;
      const bFixed = b.valueRows.length === 1 ? 0 : 1;
      if (aFixed !== bFixed) return aFixed - bFixed;
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return a.displayName.localeCompare(b.displayName);
    })
    .map((b) => ({
      name: b.displayName,
      values: b.valueRows
        .sort((x, y) => x.sort - y.sort || x.value.localeCompare(y.value))
        .map((v) => v.value),
    }));

  await db
    .update(products)
    .set({ attributeGroups: groups })
    .where(eq(products.id, productId));

  // Heal bindings so admin tooling + resolver agree with what variants
  // actually use. No-op when the binding already exists. After the
  // normalisation pass each bucket may track multiple attribute IDs that
  // collapsed into one axis — we heal a binding for every underlying ID so
  // the admin attribute editor still surfaces all of them (cleanup target).
  for (const bucket of byNormalisedName.values()) {
    for (const attributeId of bucket.attributeIds) {
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
  }

  return groups;
}
