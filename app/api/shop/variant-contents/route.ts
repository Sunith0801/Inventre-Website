/**
 * Assemble the BOM tree for an Item-Variant template SKU (e.g.
 * "SMS Grade 11 BookkitMandateCommerceMathematics").
 *
 * The parent kit doesn't carry its own bundle children — by convention,
 * each axis VALUE has a sibling sub_bundle product (e.g. "SMS Grade 11
 * Mandate", "SMS Grade 11 Commerce", "SMS Grade 11 Mathematics") whose
 * own product_bundles row holds the books. This route:
 *
 *   1. Resolves the variant's (attributeName → value) selection.
 *   2. For each value, finds the matching sub_bundle product. Lookup uses
 *      two name shapes, tried in order:
 *        a. `${value}` verbatim (already fully prefixed, e.g.
 *           "SMS Grade 11 Mandate" used both as axis-value AND product name).
 *        b. `${templatePrefix} ${value}` where templatePrefix is the
 *           parent kit's name with the trailing "Bookkit" / "Book Set" /
 *           "Kit" stripped (e.g. "SMS Grade 11" + "Commerce" =
 *           "SMS Grade 11 Commerce").
 *   3. Calls `loadBundleTree(subBundleProductId, schoolId)` for each
 *      matched sub-bundle and concatenates the results.
 *
 * Returns `{ sections: [{ axisName, value, productName, tree: BundleNode[] }, ...] }`
 * so the PDP can render each axis selection as its own accordion section.
 */
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  productVariants,
  products,
  productAttributes,
  productAttributeValues,
  productVariantAttributes,
} from "@/db/schema";
import { loadBundleTree, type BundleNode } from "@/server/repos/products";
import { getCurrentParent } from "@/server/session";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const variantId = searchParams.get("variantId");
  if (!variantId) {
    return NextResponse.json({ error: "variantId required" }, { status: 400 });
  }

  // Resolve template product and the school the parent shops for (so
  // school-scoped overrides in loadBundleTree still apply).
  const [variant] = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
    })
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .limit(1);
  if (!variant) return NextResponse.json({ sections: [] });

  const [template] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, variant.productId))
    .limit(1);
  const templateName = template?.name ?? "";
  // Strip trailing "Bookkit", "Book Set", "Kit", "Set" so the prefix lines
  // up with the sub-bundle product names ("SMS Grade 11 Bookkit" → "SMS Grade 11").
  const templatePrefix = templateName
    .replace(/\s+(book ?kit|book ?set|bookkit|bookset|kit|set)\s*$/i, "")
    .trim();

  // Variant's (attributeName, value) pairs — these are what the user picked.
  const axisRows = await db
    .select({
      attributeName: productAttributes.name,
      value: productAttributeValues.value,
      sortOrder: productAttributes.sortOrder,
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
    .where(eq(productVariantAttributes.variantId, variantId));

  const me = await getCurrentParent();
  const schoolId = me?.students[0]?.school.id ?? null;

  type Section = {
    axisName: string;
    value: string;
    productName: string | null;
    tree: BundleNode[];
  };
  const sections: Section[] = [];

  for (const axis of axisRows) {
    // Try the value as a full product name first (covers axes whose value
    // is already prefixed, e.g. "SMS Grade 11 Mandate"). Then fall back
    // to "${templatePrefix} ${value}" (covers axes with short labels like
    // "Commerce" → "SMS Grade 11 Commerce").
    const candidates = [
      axis.value,
      templatePrefix ? `${templatePrefix} ${axis.value}`.trim() : null,
    ].filter((c): c is string => !!c);

    let subProduct: { id: string; name: string } | null = null;
    for (const candidate of candidates) {
      const rows = (await db.execute(sql`
        SELECT id, name FROM products
         WHERE name = ${candidate}
           AND status = 'active'
         LIMIT 1
      `)) as unknown as { id: string; name: string }[];
      if (rows[0]) {
        subProduct = rows[0];
        break;
      }
    }

    if (!subProduct) {
      // Axis didn't resolve to a known sub-bundle product — surface it as
      // an empty section so the UI can flag "contents pending" per axis
      // instead of silently dropping it.
      sections.push({
        axisName: axis.attributeName,
        value: axis.value,
        productName: null,
        tree: [],
      });
      continue;
    }

    const tree = await loadBundleTree(subProduct.id, schoolId);
    sections.push({
      axisName: axis.attributeName,
      value: axis.value,
      productName: subProduct.name,
      tree,
    });
  }

  return NextResponse.json({ sections });
}
