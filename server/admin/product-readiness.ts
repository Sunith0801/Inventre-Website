import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  products,
  productSchool,
  productGrades,
  productVariants,
  productImages,
  productBundles,
  bundleComponents,
  itemPrices,
} from "@/db/schema";

/**
 * What a product needs before it may be published, and what it should
 * have. One definition, read by the Review & Publish step (to render the
 * checklist) AND by the status APIs (to refuse `active`) — so the list's
 * inline status menu and the bulk "Publish" button cannot bypass what the
 * step shows. Before this, anything could be flipped to active with no
 * images, no variants and no school, and parents saw nothing.
 */
export type ProductKind = typeof products.$inferSelect.kind;
export type Step = "basics" | "variants" | "bom" | "sections" | "items" | "pricing" | "content" | "images" | "publish";

export type ReadinessCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** Required checks block publishing; the rest are recommendations. */
  required: boolean;
  /** Which step fixes it. */
  step: Step;
  detail?: string;
};

export type Readiness = {
  kind: ProductKind;
  isBundle: boolean;
  checks: ReadinessCheck[];
  publishable: boolean;
  failing: ReadinessCheck[];
};

export const BUNDLE_KINDS: ReadonlySet<ProductKind> = new Set(["kit", "magic_box", "sub_bundle"]);
/** Kinds parents buy standalone — these must be tied to a school to be seen at all. */
const SCHOOL_REQUIRED_KINDS: ReadonlySet<ProductKind> = new Set(["uniform", "accessory", "consumable", "kit", "magic_box"]);

export async function getProductReadiness(productId: string): Promise<Readiness | null> {
  const [p] = await db
    .select({
      id: products.id,
      name: products.name,
      kind: products.kind,
      categoryId: products.categoryId,
      basePrice: products.basePrice,
      description: products.description,
      sizeTable: products.sizeTable,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!p) return null;

  const isBundle = BUNDLE_KINDS.has(p.kind);

  const [[schools], [grades], [variants], [pricedVariants], [images], [components], emptySections] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(productSchool).where(eq(productSchool.productId, productId)),
    db.select({ n: sql<number>`count(*)::int` }).from(productGrades).where(eq(productGrades.productId, productId)),
    db.select({ n: sql<number>`count(*)::int` }).from(productVariants).where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true))),
    db
      .select({ n: sql<number>`count(distinct ${itemPrices.variantId})::int` })
      .from(itemPrices)
      .innerJoin(productVariants, eq(productVariants.id, itemPrices.variantId))
      .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true), gt(itemPrices.price, 0))),
    db.select({ n: sql<number>`count(*)::int` }).from(productImages).where(eq(productImages.productId, productId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(bundleComponents)
      .innerJoin(productBundles, eq(productBundles.id, bundleComponents.bundleId))
      .where(eq(productBundles.productId, productId)),
    // Sections (bundle_selectors) with no saved items — a kit whose
    // "Text books" section is still empty is not finished.
    db.execute(sql`
      SELECT s.name FROM bundle_selectors s
        JOIN product_bundles b ON b.id = s.bundle_id
       WHERE b.product_id = ${productId}
         AND NOT EXISTS (SELECT 1 FROM bundle_components c WHERE c.bundle_id = s.bundle_id AND c.selector_group_key = s.group_key)
       ORDER BY s.sort_order`).then((r) => {
      const rows = (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as { name: string }[];
      return rows.map((x) => x.name);
    }),
  ]);

  const nSchools = schools?.n ?? 0;
  const nVariants = variants?.n ?? 0;
  const nPriced = pricedVariants?.n ?? 0;
  const nImages = images?.n ?? 0;
  const nComponents = components?.n ?? 0;
  const description = (p.description as string[] | null) ?? [];

  const checks: ReadinessCheck[] = [
    { key: "name", label: "Product name", ok: p.name.trim().length > 1, required: true, step: "basics" },
    {
      key: "school",
      label: "Assigned to at least one school",
      ok: nSchools > 0,
      required: SCHOOL_REQUIRED_KINDS.has(p.kind),
      step: "basics",
      detail: nSchools ? `${nSchools} school${nSchools === 1 ? "" : "s"}` : "Parents only see products of their own school",
    },
    {
      key: "grades",
      label: "Grades set",
      ok: (grades?.n ?? 0) > 0,
      required: false,
      step: "basics",
      detail: (grades?.n ?? 0) > 0 ? `${grades!.n} grade${grades!.n === 1 ? "" : "s"}` : "None set — shown to every grade of the school",
    },
    { key: "category", label: "Category", ok: !!p.categoryId, required: false, step: "basics", detail: p.categoryId ? undefined : "Drives the shop's navigation grouping" },
    isBundle
      ? {
          key: "contents",
          label: "Bundle has contents",
          ok: nComponents > 0,
          required: true,
          step: p.kind === "sub_bundle" ? "bom" : "items",
          detail: nComponents ? `${nComponents} component${nComponents === 1 ? "" : "s"}` : "An empty kit cannot be sold",
        }
      : {
          key: "contents",
          label: "At least one size or variant is on",
          ok: nVariants > 0,
          required: true,
          step: "variants",
          detail: nVariants ? `${nVariants} active` : "The buy box has nothing to offer",
        },
    {
      key: "price",
      label: "Has a price",
      ok: p.basePrice > 0 || nPriced > 0,
      required: true,
      step: "pricing",
      detail:
        p.basePrice > 0
          ? `Base ₹${(p.basePrice / 100).toLocaleString("en-IN")}${nPriced ? ` · ${nPriced} variant price${nPriced === 1 ? "" : "s"}` : ""}`
          : nPriced
            ? `${nPriced} of ${nVariants} variants priced, no base price`
            : "₹0 would sell for free",
    },
    ...(isBundle && emptySections.length
      ? [{ key: "sections", label: "Every section has items", ok: false, required: true, step: "items" as Step, detail: `Still empty: ${emptySections.join(", ")}` }]
      : []),
    ...(!isBundle && nVariants > 0 && nPriced > 0 && nPriced < nVariants && p.basePrice === 0
      ? [{ key: "price-gaps", label: "Every active variant is priced", ok: false, required: true, step: "variants" as Step, detail: `${nVariants - nPriced} variant${nVariants - nPriced === 1 ? "" : "s"} would sell at ₹0` }]
      : []),
    { key: "images", label: "At least one image", ok: nImages > 0, required: false, step: "images", detail: nImages ? `${nImages} image${nImages === 1 ? "" : "s"}` : "Shows a placeholder on the shop" },
    { key: "description", label: "Description written", ok: description.length > 0, required: false, step: "content" },
    ...(p.kind === "uniform"
      ? [{ key: "sizechart", label: "Size chart", ok: Array.isArray(p.sizeTable) && (p.sizeTable as unknown[]).length > 0, required: false, step: "content" as Step, detail: "Parents pick sizes from it" }]
      : []),
  ];

  const failing = checks.filter((c) => c.required && !c.ok);
  return { kind: p.kind, isBundle, checks, publishable: failing.length === 0, failing };
}
