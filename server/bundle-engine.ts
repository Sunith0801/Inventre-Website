import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  productBundles,
  bundleSelectors,
  bundleComponents,
  productVariants,
  products,
} from "@/db/schema";
import { getVariantPrice } from "@/server/repos/pricing";

/**
 * Bundle engine — turns a (bundleId, selectorChoices) into the concrete list
 * of variant lines that should land in the cart/order.
 *
 * Selector choices format: { [groupKey]: variantId | variantId[] }
 *   - one_of selectors → single string
 *   - multi selectors  → array of strings
 *
 * Returns the expanded line items plus a price computed per pricingMode.
 */

export type BundleExpansion = {
  productId: string; // bundle product id (parent)
  productName: string;
  bundleType: "fixed" | "configurable";
  pricingMode: "sum" | "fixed";
  components: ExpandedComponent[];
  totalPrice: number; // paise
};

export type ExpandedComponent = {
  variantId: string;
  qty: number;
  unitPrice: number; // paise
};

export async function expandBundle(args: {
  productId: string;
  selections?: Record<string, string | string[]>;
  schoolId?: string | null;
}): Promise<BundleExpansion | null> {
  const [bundle] = await db
    .select()
    .from(productBundles)
    .where(eq(productBundles.productId, args.productId))
    .limit(1);
  if (!bundle) return null;

  const [parentProduct] = await db
    .select()
    .from(products)
    .where(eq(products.id, args.productId))
    .limit(1);
  if (!parentProduct) return null;

  const [selectors, components] = await Promise.all([
    db.select().from(bundleSelectors).where(eq(bundleSelectors.bundleId, bundle.id)),
    db.select().from(bundleComponents).where(eq(bundleComponents.bundleId, bundle.id)),
  ]);

  const expanded: ExpandedComponent[] = [];
  const selections = args.selections ?? {};

  // 1. Always-included components (no selectorGroupKey)
  for (const c of components.filter((x) => !x.selectorGroupKey)) {
    if (!c.variantId) continue;
    const price = await getVariantPrice(c.variantId, { schoolId: args.schoolId ?? null });
    if (price === null) continue;
    expanded.push({ variantId: c.variantId, qty: c.qty, unitPrice: price });
  }

  // 2. For each selector, pick chosen component(s)
  for (const sel of selectors) {
    const chosen = selections[sel.groupKey];
    if (sel.isRequired && !chosen) {
      throw new Error(`Selector "${sel.name}" is required`);
    }
    const chosenIds = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
    if (sel.minSelections && chosenIds.length < sel.minSelections) {
      throw new Error(`Selector "${sel.name}" requires at least ${sel.minSelections} choice(s)`);
    }
    if (sel.maxSelections && chosenIds.length > sel.maxSelections) {
      throw new Error(`Selector "${sel.name}" allows at most ${sel.maxSelections} choice(s)`);
    }

    const groupComponents = components.filter(
      (c) => c.selectorGroupKey === sel.groupKey
    );

    for (const variantId of chosenIds) {
      const matched = groupComponents.find((c) => c.variantId === variantId);
      if (!matched) {
        throw new Error(`Invalid choice "${variantId}" for selector "${sel.name}"`);
      }
      const price = await getVariantPrice(variantId, { schoolId: args.schoolId ?? null });
      if (price === null) continue;
      expanded.push({ variantId, qty: matched.qty, unitPrice: price });
    }
  }

  // 3. Compute total price
  let totalPrice: number;
  if (bundle.pricingMode === "fixed" && bundle.fixedPrice != null) {
    totalPrice = bundle.fixedPrice;
  } else {
    totalPrice = expanded.reduce((s, c) => s + c.qty * c.unitPrice, 0);
  }

  return {
    productId: args.productId,
    productName: parentProduct.name,
    bundleType: bundle.bundleType,
    pricingMode: bundle.pricingMode,
    components: expanded,
    totalPrice,
  };
}

/** Get the full bundle config (for PDP rendering): selectors + their options. */
export async function getBundlePdpConfig(args: {
  productId: string;
  schoolId?: string | null;
}) {
  const [bundle] = await db
    .select()
    .from(productBundles)
    .where(eq(productBundles.productId, args.productId))
    .limit(1);
  if (!bundle) return null;

  const [selectors, components] = await Promise.all([
    db
      .select()
      .from(bundleSelectors)
      .where(eq(bundleSelectors.bundleId, bundle.id)),
    db
      .select({ comp: bundleComponents, variant: productVariants, product: products })
      .from(bundleComponents)
      .leftJoin(productVariants, eq(productVariants.id, bundleComponents.variantId))
      .leftJoin(products, eq(products.id, productVariants.productId))
      .where(eq(bundleComponents.bundleId, bundle.id)),
  ]);

  return {
    bundleType: bundle.bundleType,
    pricingMode: bundle.pricingMode,
    fixedPrice: bundle.fixedPrice,
    selectors: selectors.map((s) => ({
      groupKey: s.groupKey,
      name: s.name,
      type: s.selectorType,
      isRequired: s.isRequired,
      minSelections: s.minSelections,
      maxSelections: s.maxSelections,
      options: components
        .filter((c) => c.comp.selectorGroupKey === s.groupKey)
        .map((c) => ({
          variantId: c.variant?.id ?? null,
          label:
            c.comp.selectorOptionLabel ?? c.product?.name ?? "Option",
          productName: c.product?.name ?? "?",
          size: c.variant?.size ?? "",
          qty: c.comp.qty,
        })),
    })),
    alwaysIncluded: components
      .filter((c) => !c.comp.selectorGroupKey)
      .map((c) => ({
        variantId: c.variant?.id ?? null,
        productName: c.product?.name ?? "?",
        size: c.variant?.size ?? "",
        qty: c.comp.qty,
      })),
  };
}
