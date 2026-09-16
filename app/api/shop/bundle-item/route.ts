/**
 * Variant list + resolved prices for a single product, used by the PDP's
 * bundle accordion and the Magic Box configurator so a parent can pick a
 * sub-item's size, see its price, and add that variation to the cart.
 *
 *   GET ?productId=<uuid>&studentId=<uuid>
 *     → { variants: [{ id, size, sku, pricePaise, mrpPaise, available }] }
 *
 * A product often carries many product_variants rows for the same size
 * (per-school / per-colour duplicates from the ERP import). We collapse
 * them to one entry per distinct, cleaned, sorted size label.
 */
import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  productVariants,
  products,
  productAttributes,
  productAttributeValues,
  productVariantAttributes,
  productImages as productImagesTable,
} from "@/db/schema";
import { requireParent, isResponse } from "@/server/parent-guard";
import { sortSizes, pickKitFallbackImage } from "@/server/repos/products";
import { buildAttributeKey } from "@/lib/attribute-key";

/**
 * Strip the ERPNext per-template size prefix (e.g. "V28" → "28", "BL24" →
 * "24") uniformly across the whole set, so every variant maps to exactly
 * one display label. Same decision for every row — never mixed — so two
 * labels can't collapse onto the same variant.
 */
function strippedLabels(sizes: string[]): string[] {
  if (sizes.length < 2) return sizes;
  // Never strip product names — only short size codes (no spaces, ≤ 15 chars).
  if (sizes.some((s) => s.includes(" ") || s.length > 15)) return sizes;
  const allAlphaLed = sizes.every((s) => s.length > 1 && /^[A-Z]/i.test(s));
  if (!allAlphaLed) return sizes;
  // Two-letter colour prefixes (BL24, GR26 …): strip 2 when it de-dupes.
  if (sizes.every((s) => s.length > 2 && /^[A-Z]{2}\d/i.test(s))) {
    const s2 = sizes.map((s) => s.slice(2));
    if (new Set(s2).size < new Set(sizes).size) return s2;
  }
  const firstLetters = new Set(sizes.map((s) => s[0].toUpperCase()));
  const s1 = sizes.map((s) => s.slice(1));
  if (firstLetters.size === 1) return s1;
  if (new Set(s1).size < new Set(sizes).size) return s1;
  return sizes;
}

export async function GET(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");
  const requestedStudent = searchParams.get("studentId");
  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  // Per-school price overrides are scoped to the active student's school.
  const activeStudent =
    (requestedStudent &&
      me.students.find((s) => s.id === requestedStudent)) ||
    me.students[0];
  const schoolId = activeStudent?.school.id ?? null;

  const vars = await db
    .select()
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, productId),
        eq(productVariants.isActive, true)
      )
    );

  const { resolveVariants } = await import("@/server/repos/variant-resolver");
  const resolved = await resolveVariants(
    vars.map((v) => v.id),
    schoolId
  );

  // Collapse duplicate-size variant rows: one representative variant per
  // distinct cleaned size label, then sort into a human-friendly order.
  const labels = strippedLabels(vars.map((v) => v.size));
  const byLabel = new Map<string, (typeof vars)[number]>();
  labels.forEach((label, i) => {
    if (!byLabel.has(label)) byLabel.set(label, vars[i]);
  });

  const variants = sortSizes([...byLabel.keys()]).map((label) => {
    const v = byLabel.get(label)!;
    const r = resolved.get(v.id);
    return {
      id: v.id,
      size: label,
      sku: v.sku,
      pricePaise: r?.pricePaise ?? null,
      mrpPaise: r?.mrpPaise ?? null,
      // Resolver figure only (Ground Stock bins) — never the legacy column.
      available: r?.available ?? 0,
    };
  });

  // Multi-axis bookkit support inside Magic Boxes: surface the same
  // attribute_groups + variantsByAttributeKey the PDP uses so the
  // configurator can render the same MultiAttributePicker. Also surface
  // the per-item image + size-table so each row can render a thumbnail
  // and open a per-item size guide.
  const [productRow] = await db
    .select({
      attributeGroups: products.attributeGroups,
      kind: sql<string>`kind::text`,
      name: products.name,
      sizeTable: products.sizeTable,
      sizeChartUrl: products.sizeChartUrl,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  // Only the item's OWN primary image. We intentionally do NOT fall
  // back to a sibling-grade kit's photo — a Grade 10 kit visual on a
  // Grade 11 row is more misleading than a generic Package icon.
  let imageUrl: string | null = null;
  const ownImg = await db
    .select({ url: productImagesTable.url })
    .from(productImagesTable)
    .where(eq(productImagesTable.productId, productId))
    .orderBy(productImagesTable.sortOrder)
    .limit(1);
  if (ownImg[0]?.url) imageUrl = ownImg[0].url;

  let attributeGroups: { name: string; values: string[] }[] = [];
  let variantsByAttributeKey: Record<string, string> = {};
  if (productRow?.attributeGroups) {
    attributeGroups =
      (productRow.attributeGroups as { name: string; values: string[] }[]) ?? [];
    const attrRows = await db
      .select({
        variantId: productVariantAttributes.variantId,
        attrName: productAttributes.name,
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
      .where(inArray(productVariantAttributes.variantId, vars.map((v) => v.id)));
    const byVariant = new Map<string, Record<string, string>>();
    for (const r of attrRows) {
      let m = byVariant.get(r.variantId);
      if (!m) {
        m = {};
        byVariant.set(r.variantId, m);
      }
      m[r.attrName] = r.value;
    }
    for (const [vid, sel] of byVariant) {
      variantsByAttributeKey[buildAttributeKey(sel)] = vid;
    }
  }

  return NextResponse.json({
    variants,
    attributeGroups,
    variantsByAttributeKey,
    kind: productRow?.kind ?? null,
    imageUrl,
    sizeTable: productRow?.sizeTable ?? null,
    sizeChartUrl: productRow?.sizeChartUrl ?? null,
    name: productRow?.name ?? null,
  });
}
