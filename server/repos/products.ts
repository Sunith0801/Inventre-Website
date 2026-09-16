import "server-only";
import { eq, and, desc, asc, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  products,
  productSchool,
  productVariants,
  productImages,
  productAttributeValues,
  productBadges,
  productBundles,
  bundleComponents,
  categories,
  reviews,
} from "@/db/schema";
import { cached } from "@/server/cache";
import { safeImgUrl } from "@/lib/safe-url";

export type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  path: string;
  children: CategoryNode[];
};

export type ProductCardDto = {
  id: string;
  slug: string;
  name: string;
  categoryPath: string[];
  price: number; // paise
  mrp: number | null;
  sizes: string[];
  inStock: boolean;
  badge: "NEW" | "BESTSELLER" | "LOW_STOCK" | null;
  img: string | null;
  required: boolean;
  isMagicBox: boolean;
  isKit?: boolean;
  /** True when the kit has language options (template-variant or sibling-kit style). */
  hasLangOptions?: boolean;
};

export type ProductDetailDto = ProductCardDto & {
  tagline: string | null;
  description: string[] | null;
  specs: { label: string; value: string }[] | null;
  sizeTable: { size: string; chest: string; length: string; sleeve: string }[] | null;
  sizeChartUrl: string | null;
  /** Free-text note shown under the product image on the PDP. */
  imageNote: string | null;
  variants: {
    id: string;
    size: string;
    sku: string;
    stockQty: number;
    pricePaise: number;
    mrpPaise: number | null;
    /** True when this variant carries a real price — an explicit item_prices
     *  row (even ₹0) or a positive fallback. False = "price never set". */
    priced: boolean;
  }[];
  /** Template-level variants (e.g. Bookkit Hindi vs Bookkit Kannada).
   *  Empty when this product isn't a template. */
  templateVariants: {
    id: string;
    name: string;
    slug: string;
    price: number;
    mrp: number | null;
    inStock: boolean;
    /** Selector group (e.g. "winmore whitefield grade 6 language selection") */
    attributeName: string | null;
    /** Display value (e.g. "Winmore Whitefield Grade 6 Hindi 2nd Lan") */
    attributeValue: string | null;
  }[];
  /** Multi-attribute selector groups (Color + Size + ...) used on uniform
   *  PDPs. Each group renders as a separate picker. */
  attributeGroups: { name: string; values: string[] }[];
  /** Lookup from a stable `buildAttributeKey({attr → value})` string to the
   *  matching variant id. Empty when the product has no `product_variant_attributes`
   *  rows (single-axis size-only products use `variants[].size` instead).
   *  See `lib/attribute-key.ts` for the encoding contract. */
  variantsByAttributeKey: Record<string, string>;
  /** Stand-in PDP image used only when this product has no uploaded photo
   *  AND it's a kit. Resolved from the nearest-grade sibling kit at the
   *  same school, falling back to any kit. Catalog grid cards do NOT use
   *  this (they keep showing "no image" so the data gap stays visible to
   *  admins). null when no candidate exists. */
  fallbackImageUrl: string | null;
  /** `colorValue` carries the attribute value (e.g. "Blue") this image
   *  belongs to — from an explicit admin tag (product_images.attribute_value_id)
   *  or, failing that, a non-size attribute value found in the alt text.
   *  null = generic image, shown regardless of selection. */
  images: { id: string; url: string; alt: string | null; colorValue: string | null }[];
  rating: { score: number; count: number; distribution: number[] } | null;
  /** Recursive BOM subtree rooted at this product. Empty when the product has
   *  no `product_bundles` row. Children render as an inline accordion on the
   *  PDP; each node may itself be a bundle whose `children` expand further. */
  bundleTree: BundleNode[];
  /** True when this product is a sellable bundle whose root price + selections
   *  go through the configurable add-to-cart flow. False = regular variant
   *  add-to-cart. */
  isBundle: boolean;
  /** True when products.kind = 'magic_box'. Drives the mandatory
   *  per-item size configurator on the PDP. */
  isMagicBox: boolean;
  kind: string;
  kitLanguageVariants: { id: string; name: string; slug: string; price: number; img: string | null }[];
};

export type BundleNode = {
  componentId: string; // bundle_components.id — stable key for selection state
  productId: string;
  slug: string;
  name: string;
  /** products.kind — book | sub_bundle | kit | uniform | magic_box | … */
  bundleLevel: string;
  qty: number;
  pricePaise: number;
  mrpPaise: number | null;
  img: string | null;
  isOptional: boolean;
  selectorGroupKey: string | null;
  selectorOptionLabel: string | null;
  children: BundleNode[];
};

// ── helpers ─────────────────────────────────────────────────

const BUNDLE_TREE_MAX_DEPTH = 5;

/**
 * Walk the BOM subtree rooted at `rootProductId` and return it as a nested
 * BundleNode array. Iterative BFS so we batch DB calls per level — at most
 * one (product_bundles + bundle_components + products + product_school)
 * round-trip per depth, capped at BUNDLE_TREE_MAX_DEPTH levels.
 *
 * Per-school price/MRP overrides are honoured: a child product priced
 * differently at this school surfaces that price on the PDP card.
 *
 * Returns `[]` when the root product has no product_bundles row (i.e. it's
 * not a bundle).
 */
export async function loadBundleTree(
  rootProductId: string,
  schoolId: string | null
): Promise<BundleNode[]> {
  type Row = {
    id: string;
    parent_product_id: string;
    child_product_id: string;
    qty: number;
    is_optional: boolean;
    selector_group_key: string | null;
    selector_option_label: string | null;
    child_slug: string;
    child_name: string;
    bundle_level: string;
    child_base_price: number;
    child_base_mrp: number | null;
    child_img: string | null;
    override_price: number | null;
    override_mrp: number | null;
    override_img: string | null;
  };

  // Single round-trip recursive CTE — walks the BOM tree under
  // `rootProductId` up to BUNDLE_TREE_MAX_DEPTH levels, in DB. This sidesteps
  // any per-level JS array binding the production minifier might mangle.
  const rows = (await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT ${rootProductId}::uuid AS product_id, 0 AS depth
      UNION ALL
      SELECT bc.product_id, t.depth + 1
        FROM tree t
        JOIN product_bundles pb ON pb.product_id = t.product_id
        JOIN bundle_components bc ON bc.bundle_id = pb.id
        JOIN products child ON child.id = bc.product_id
       WHERE t.depth < ${BUNDLE_TREE_MAX_DEPTH}
         AND bc.product_id IS NOT NULL
         AND child.status <> 'archived'
         AND bc.is_visible = true
    )
    SELECT
      bc.id                          AS id,
      pb.product_id                  AS parent_product_id,
      bc.product_id                  AS child_product_id,
      bc.qty                         AS qty,
      bc.is_optional                 AS is_optional,
      bc.selector_group_key          AS selector_group_key,
      bc.selector_option_label       AS selector_option_label,
      child.slug                     AS child_slug,
      child.name                     AS child_name,
      child.kind::text               AS bundle_level,
      child.base_price               AS child_base_price,
      child.base_mrp                 AS child_base_mrp,
      (SELECT url FROM product_images WHERE product_id = child.id
         ORDER BY is_primary DESC NULLS LAST, sort_order ASC LIMIT 1)
                                     AS child_img,
      ps.override_price              AS override_price,
      ps.override_mrp                AS override_mrp,
      ps.custom_image_url            AS override_img
      FROM tree t
      JOIN product_bundles pb ON pb.product_id = t.product_id
      JOIN bundle_components bc ON bc.bundle_id = pb.id
      JOIN products child ON child.id = bc.product_id
      LEFT JOIN product_school ps
        ON ps.product_id = child.id AND ps.school_id = ${schoolId}
     WHERE bc.product_id IS NOT NULL
       AND child.status <> 'archived'
       AND bc.is_visible = true
     ORDER BY t.depth, bc.selector_group_key NULLS FIRST, child.name
  `)) as unknown as Row[];

  const childrenOf = new Map<string, BundleNode[]>();
  for (const r of rows) {
    const node: BundleNode = {
      componentId: r.id,
      productId: r.child_product_id,
      slug: r.child_slug,
      name: r.child_name,
      bundleLevel: r.bundle_level,
      qty: r.qty,
      pricePaise: r.override_price ?? r.child_base_price,
      mrpPaise: r.override_mrp ?? r.child_base_mrp,
      img: safeImgUrl(r.override_img ?? r.child_img ?? null),
      isOptional: r.is_optional,
      selectorGroupKey: r.selector_group_key,
      selectorOptionLabel: r.selector_option_label,
      children: [],
    };
    const bucket = childrenOf.get(r.parent_product_id) ?? [];
    bucket.push(node);
    childrenOf.set(r.parent_product_id, bucket);
  }

  // Wire up the children arrays.
  for (const bucket of childrenOf.values()) {
    for (const node of bucket) {
      node.children = childrenOf.get(node.productId) ?? [];
    }
  }

  return childrenOf.get(rootProductId) ?? [];
}


/** Fetch sibling variants for a template (Variant Of points here). Returns
 *  empty for non-template products. */
async function loadTemplateVariants(productId: string) {
  const rows = (await db.execute(sql`
    SELECT id, name, slug, base_price, base_mrp,
           variant_attribute, variant_attribute_value
      FROM products
     WHERE variant_of_product_id = ${productId}
       AND status = 'active'
     ORDER BY name
  `)) as unknown as {
    id: string;
    name: string;
    slug: string;
    base_price: number;
    base_mrp: number | null;
    variant_attribute: string | null;
    variant_attribute_value: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    price: rupeesFromPaise(r.base_price),
    mrp: r.base_mrp != null ? rupeesFromPaise(r.base_mrp) : null,
    inStock: true,
    attributeName: r.variant_attribute,
    attributeValue: r.variant_attribute_value,
  }));
}

/**
 * Stand-in PDP photo for a kit product that has no uploaded image. Looks
 * for a sibling kit's image, ranked by:
 *   1. Same school, closest grade (lower numeric distance wins).
 *   2. Any school, closest grade.
 *   3. Any kit with an image.
 * Used only on the PDP. Returns `null` when no candidate exists.
 */
export async function pickKitFallbackImage(
  productId: string,
  productName: string,
  kind: string,
  schoolId: string | null
): Promise<string | null> {
  if (kind !== "kit") return null;

  const gradeMatch = productName.match(/grade\s+(\d+|nursery|lkg|ukg|kg)/i);
  const targetGradeRaw = gradeMatch?.[1]?.toLowerCase() ?? null;
  const targetGradeNum = targetGradeRaw ? parseInt(targetGradeRaw, 10) : NaN;

  // Score: lower is closer. Same-school siblings get a -1000 boost so they
  // always win over any-school candidates at the same numeric distance.
  type Candidate = { name: string; url: string; sameSchool: boolean };
  const score = (c: Candidate): number => {
    const base = c.sameSchool ? -1000 : 0;
    if (!targetGradeRaw) return base + 100;
    const m = c.name.match(/grade\s+(\d+|nursery|lkg|ukg|kg)/i);
    if (!m) return base + 99;
    const g = m[1].toLowerCase();
    if (g === targetGradeRaw) return base + 0;
    const a = parseInt(g, 10);
    if (!isNaN(a) && !isNaN(targetGradeNum)) {
      // Prefer same-or-lower grade on ties: a Grade-9 photo represents a
      // Grade-11 kit better than the Grade-12 one (senior secondary
      // materials diverge sharply from junior; junior is closer in spirit).
      const dist = Math.abs(a - targetGradeNum);
      return base + dist + (a > targetGradeNum ? 0.5 : 0);
    }
    return base + 50;
  };

  const candidates: Candidate[] = [];
  if (schoolId) {
    const rows = (await db.execute(sql`
      SELECT p.name, pi.url
        FROM products p
        JOIN product_school ps ON ps.product_id = p.id AND ps.school_id = ${schoolId}
        JOIN product_images pi ON pi.product_id = p.id
       WHERE p.kind::text = 'kit'
         AND p.id <> ${productId}
         AND p.status = 'active'
       LIMIT 100
    `)) as unknown as { name: string; url: string }[];
    for (const r of rows) candidates.push({ name: r.name, url: r.url, sameSchool: true });
  }
  if (candidates.length === 0) {
    const rows = (await db.execute(sql`
      SELECT p.name, pi.url
        FROM products p
        JOIN product_images pi ON pi.product_id = p.id
       WHERE p.kind::text = 'kit'
         AND p.id <> ${productId}
         AND p.status = 'active'
       LIMIT 100
    `)) as unknown as { name: string; url: string }[];
    for (const r of rows) candidates.push({ name: r.name, url: r.url, sameSchool: false });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => score(a) - score(b));
  return candidates[0].url;
}

/**
 * Build the multi-axis (name → value) → variantId lookup for a product's
 * active variants. Used by the PDP picker to resolve a complete selection
 * into a single variant SKU without a server round-trip per click.
 * Returns an empty object when the product has no variant-attribute rows,
 * so single-axis size-only products keep using the legacy `size` path.
 */
async function loadVariantsByAttributeKey(
  productId: string
): Promise<Record<string, string>> {
  const { buildAttributeKey } = await import("@/lib/attribute-key");
  const rows = (await db.execute(sql`
    SELECT pv.id AS variant_id, pa.name AS attr_name, av.value AS val
      FROM product_variants pv
      JOIN product_variant_attributes pva ON pva.variant_id = pv.id
      JOIN product_attributes pa ON pa.id = pva.attribute_id
      JOIN product_attribute_values av ON av.id = pva.value_id
     WHERE pv.product_id = ${productId}
       AND pv.is_active = true
  `)) as unknown as { variant_id: string; attr_name: string; val: string }[];
  if (rows.length === 0) return {};
  const byVariant = new Map<string, Record<string, string>>();
  for (const r of rows) {
    let m = byVariant.get(r.variant_id);
    if (!m) {
      m = {};
      byVariant.set(r.variant_id, m);
    }
    m[r.attr_name] = r.val;
  }
  const out: Record<string, string> = {};
  for (const [variantId, sel] of byVariant) {
    out[buildAttributeKey(sel)] = variantId;
  }
  return out;
}

async function loadKitLanguageVariants(
  productId: string,
  schoolId: string | null
): Promise<{ id: string; name: string; slug: string; price: number; img: string | null }[]> {
  if (!schoolId) return [];
  // Sibling kits are stored as separate `products` rows with
  // `is_variant_item=true` and `variant_of_product_id` pointing at the
  // template. Each carries its own BOM via product_bundles +
  // bundle_components. Earlier code filtered by `name ILIKE '%2nd Lan%'`
  // — that captured the CAS naming convention but missed WM/SMS/SAS kits
  // whose siblings are named e.g. "WM WF Grade 9 BookkitHindi" without
  // a "2nd Lan" suffix.
  //
  // School linking quirk: ERP imports `product_school` only for the
  // template, not for sibling-variant kits. So we resolve the school
  // link via the TEMPLATE (the requested productId) and inherit any
  // sibling's image from `product_images` directly.
  const rows = (await db.execute(sql`
    SELECT DISTINCT p.id, p.name, p.slug, p.base_price,
           (SELECT url FROM product_images
             WHERE product_id = p.id
             ORDER BY is_primary DESC NULLS LAST, sort_order ASC LIMIT 1) AS img
      FROM products p
     WHERE p.variant_of_product_id = ${productId}
       AND p.status = 'active'
       AND p.kind = 'kit'
       AND EXISTS (
         SELECT 1 FROM product_school ps
         WHERE ps.product_id = ${productId} AND ps.school_id = ${schoolId}
       )
       AND EXISTS (
         SELECT 1 FROM product_bundles pb
          JOIN bundle_components bc ON bc.bundle_id = pb.id
         WHERE pb.product_id = p.id
       )
     ORDER BY p.name
  `)) as unknown as { id: string; name: string; slug: string; base_price: number; img: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    price: rupeesFromPaise(r.base_price),
    img: safeImgUrl(r.img),
  }));
}

function rupeesFromPaise(paise: number): number {
  return Math.round(paise / 100);
}

/** Strip a single-letter ERPNext prefix that's shared across all sizes
 *  of a product. Each uniform template uses its own marker:
 *    V28, V18, V36         → 28, 18, 36       (Shirt)
 *    Q34-22, Q26-16        → 34-22, 26-16     (Skort)
 *    L2XL, LL, LM, LS, LXL → 2XL, L, M, S, XL (Belt)
 *    M22, M24, M34         → 22, 24, 34       (Hoodie)
 *  Detected per-product because the prefix differs per item. Single-
 *  letter pure sizes like "S","M","L" are preserved (no rest to strip).
 *  The underlying product_variants.size keeps the prefix so cart-add
 *  still resolves the right SKU. */
export function cleanSizeLabels(sizes: string[]): string[] {
  if (sizes.length < 2) return sizes;
  // Never strip descriptive labels (bookkit names, subject lines, etc.)
  if (sizes.some((s) => s.includes(" "))) return sortSizes(sizes);
  if (!sizes.every((s) => s.length > 1 && /^[A-Z]/i.test(s))) return sortSizes(sizes);
  // Try 2-char strip FIRST when input is uniformly 2 letters + digit.
  // Catches color prefixes like BL24/GR26/RE30/YL24 before the 1-char
  // strip mangles them (BL24 → L24 is a false positive otherwise).
  if (sizes.every((s) => s.length > 2 && /^[A-Z]{2}\d/i.test(s))) {
    const stripped2 = sizes.map((s) => s.slice(2));
    const uniq2 = new Set(stripped2);
    if (uniq2.size < sizes.length) return sortSizes([...uniq2]);
  }
  const firstLetters = new Set(sizes.map((s) => s[0].toUpperCase()));
  const stripped1 = sizes.map((s) => s.slice(1));
  if (firstLetters.size === 1) return sortSizes([...new Set(stripped1)]);
  const uniq1 = new Set(stripped1);
  if (uniq1.size < sizes.length) return sortSizes([...uniq1]);
  return sortSizes(sizes);
}

/** Human-friendly size order:
 *    1) pure numeric ascending      (18, 20, 22, …)
 *    2) waist-length (34-22) by waist then length
 *    3) apparel alpha order         (XS, S, M, L, XL, 2XL, …)
 *    4) digit-prefixed UK/S codes   (1UK, 6S, 10UK, …)
 *    5) anything else alphabetical
 */
const ALPHA_ORDER = [
  "XXS", "XS", "S", "M", "L", "XL", "XXL",
  "2XL", "3XL", "4XL", "5XL", "6XL",
];
function sizeSortKey(s: string): [number, number, number, string] {
  if (/^\d+$/.test(s)) return [1, parseInt(s, 10), 0, s];
  const dash = s.match(/^(\d+)-(\d+)$/);
  if (dash) return [2, parseInt(dash[1], 10), parseInt(dash[2], 10), s];
  const ai = ALPHA_ORDER.indexOf(s.toUpperCase());
  if (ai >= 0) return [3, ai, 0, s];
  const lead = s.match(/^(\d+)/);
  if (lead) return [4, parseInt(lead[1], 10), 0, s];
  return [5, 0, 0, s.toUpperCase()];
}
export function sortSizes(sizes: string[]): string[] {
  const arr = [...sizes];
  arr.sort((a, b) => {
    const ka = sizeSortKey(a);
    const kb = sizeSortKey(b);
    for (let i = 0; i < 3; i++) {
      const va = ka[i] as number;
      const vb = kb[i] as number;
      if (va !== vb) return va - vb;
    }
    return (ka[3] as string).localeCompare(kb[3] as string);
  });
  return arr;
}

async function loadCategoryPath(categoryId: string | null): Promise<string[]> {
  if (!categoryId) return [];
  const rows = await db.select().from(categories);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path: string[] = [];
  let cur = byId.get(categoryId);
  while (cur) {
    path.unshift(cur.slug);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

// ── public API ──────────────────────────────────────────────

export async function listSchoolProducts(schoolId: string): Promise<ProductCardDto[]> {
  // Very short TTL (5s) — admin writes invalidate this key on save, so the
  // cache normally never serves stale data. The tiny ceiling exists only to
  // absorb traffic bursts (concurrent parents loading the same school) and
  // means any future write path that forgets to invalidate still recovers
  // within five seconds.
  return cached(`products:school:${schoolId}`, 5, async () => {
    const rows = await db
      .select({
        product: products,
        ps: productSchool,
      })
      .from(products)
      .innerJoin(productSchool, eq(productSchool.productId, products.id))
      .where(
        and(eq(productSchool.schoolId, schoolId), eq(products.status, "active"))
      )
      .orderBy(asc(products.name));

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.product.id);
    const [vars, imgs, badges] = await Promise.all([
      db
        .select()
        .from(productVariants)
        .where(
          and(
            inArray(productVariants.productId, ids),
            eq(productVariants.isActive, true)
          )
        ),
      db.select().from(productImages).where(inArray(productImages.productId, ids)),
      db.select().from(productBadges).where(inArray(productBadges.productId, ids)),
    ]);
    // Resolve price + stock from new system (bins / itemPrices) with legacy fallback.
    const { resolveVariants } = await import("@/server/repos/variant-resolver");
    const variantIds = vars.map((v) => v.id);
    const resolved = await resolveVariants(variantIds, schoolId);

    // Build a map: productId -> categoryPath segments (slug)
    const { getCategoryMap } = await import("@/server/repos/categories");
    const catById = await getCategoryMap();
    const pathFor = (categoryId: string | null) => {
      if (!categoryId) return [] as string[];
      const out: string[] = [];
      let cur = catById.get(categoryId);
      while (cur) {
        out.unshift(cur.slug);
        cur = cur.parentId ? catById.get(cur.parentId) : undefined;
      }
      return out;
    };

    return rows.map(({ product, ps }) => {
      const productImagesList = imgs
        .filter((i) => i.productId === product.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const productVariantsList = vars.filter((v) => v.productId === product.id);
      // Use resolved (bins/itemPrices) with legacy fallback.
      // Availability comes from the resolver only (Ground Stock bins via the
      // one rule); a variant the resolver dropped (inactive) counts as none.
      const totalStock = productVariantsList.reduce((s, v) => {
        const r = resolved.get(v.id);
        return s + (r?.available ?? 0);
      }, 0);
      // Use price from first variant's resolved info; falls back to product.basePrice
      const firstVariant = productVariantsList[0];
      const firstResolved = firstVariant ? resolved.get(firstVariant.id) : null;
      const pricePaise = firstResolved?.pricePaise ?? ps.overridePrice ?? product.basePrice;
      const mrpPaise = firstResolved?.mrpPaise ?? ps.overrideMrp ?? product.baseMrp;
      const productBadge = badges.find((b) => b.productId === product.id);

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        categoryPath: pathFor(product.categoryId),
        price: rupeesFromPaise(pricePaise),
        mrp: mrpPaise != null ? rupeesFromPaise(mrpPaise) : null,
        sizes: cleanSizeLabels(productVariantsList.map((v) => v.size)),
        // In stock when any size can be bought. Since 2026-09-16 the figure
        // behind this is the audit's Ground Stock count (see variant-resolver);
        // a product with no variant rows at all has nothing to gate on.
        inStock: productVariantsList.length === 0 || totalStock > 0,
        badge: productBadge?.badge ?? null,
        img: safeImgUrl(ps.customImageUrl ?? productImagesList[0]?.url ?? null),
        required: ps.isRequired,
        isMagicBox: product.isMagicBox,
      } satisfies ProductCardDto;
    });
  });
}

/**
 * Shop feed for the active student. Two distinct queries, picked by
 * `isNewStudent`:
 *
 *   • new student  → ONLY magic_box rows tagged for (school, grade).
 *     Boys and Girls boxes both appear regardless of student.gender.
 *
 *   • returning    → root-only catalog: every (school, grade)-tagged product
 *     whose kind is shoppable (i.e. NOT magic_box / book / sub_bundle) AND
 *     that doesn't appear as a child anywhere in another tagged product's
 *     BOM. 2nd-language sibling kits ("…2nd Lan") are also excluded so the
 *     PDP can present them as language picker options instead.
 *
 * Per-school price/MRP/image overrides from product_school are applied
 * during hydration via resolveVariants() + the explicit ps row.
 */
export async function listProductsForStudent(args: {
  schoolId: string;
  grade: string;
  isNewStudent: boolean;
}): Promise<ProductCardDto[]> {
  const { schoolId, grade, isNewStudent } = args;

  // New students see ALL Magic Boxes for their (school, grade) regardless of
  // gender — the curated starter rollup. Returning students see the regular
  // catalog (bookkits + uniforms) with Magic Box excluded.
  //
  // Schools without Magic Box rollups (CAS, TSUSC, etc.) used to fall into
  // the magic-box branch for any new student and get an empty catalog.
  // Detect that here and fall back to the regular catalog so a new student
  // at a non-Magic-Box school still sees uniforms / bookkits / accessories.
  const magicBoxRows = isNewStudent
    ? ((await db.execute(sql`
        SELECT p.id
          FROM products p
          JOIN product_school ps ON ps.product_id = p.id AND ps.school_id = ${schoolId}
          JOIN product_grades pg ON pg.product_id = p.id AND pg.grade = ${grade}
         WHERE p.status = 'active'
           AND p.is_variant_item = false
           AND p.kind = 'magic_box'
      `)) as unknown as { id: string }[])
    : [];

  // Root-only catalog: select tagged products that are NOT contained in
  // any other tagged product's BOM. E.g. when "TSUS Book Set Grade 2"
  // exists at (TSUSC, Grade 2), its child "Bundle 5 Textbook" and that
  // bundle's leaf textbooks are hidden — the parent buys the top-level
  // rollup, not its duplicated components.
  const regularRows =
    isNewStudent && magicBoxRows.length > 0
      ? []
      : ((await db.execute(sql`
          WITH RECURSIVE
          catalog AS (
            SELECT p.id
              FROM products p
              JOIN product_school ps ON ps.product_id = p.id AND ps.school_id = ${schoolId}
              JOIN product_grades pg ON pg.product_id = p.id AND pg.grade = ${grade}
             WHERE p.status = 'active'
               AND p.is_variant_item = false
               AND p.kind::text NOT IN ('magic_box', 'book', 'sub_bundle')
               AND NOT (p.kind::text IN ('kit', 'set') AND p.name ILIKE '%2nd Lan%')
          ),
          contained AS (
            -- Direct children of catalog products
            SELECT DISTINCT bc.product_id AS id
              FROM bundle_components bc
              JOIN product_bundles pb ON pb.id = bc.bundle_id
             WHERE pb.product_id IN (SELECT id FROM catalog)
               AND bc.product_id IS NOT NULL
            UNION
            -- Recursive: children of already-contained products (handles kit→sub_bundle→book)
            SELECT bc2.product_id AS id
              FROM contained c
              JOIN product_bundles pb2 ON pb2.product_id = c.id
              JOIN bundle_components bc2 ON bc2.bundle_id = pb2.id
             WHERE bc2.product_id IS NOT NULL
          )
          SELECT id FROM catalog
           WHERE id NOT IN (SELECT id FROM contained)
        `)) as unknown as { id: string }[]);

  const idRows = magicBoxRows.length > 0 ? magicBoxRows : regularRows;

  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) return [];

  // Hydration: full product rows + per-school overrides + variants/images/badges.
  const productRows = await db
    .select({ product: products, ps: productSchool })
    .from(products)
    .innerJoin(
      productSchool,
      and(eq(productSchool.productId, products.id), eq(productSchool.schoolId, schoolId))
    )
    .where(inArray(products.id, ids))
    .orderBy(asc(products.name));

  const [vars, imgs, badges, kindRows] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true))),
    db.select().from(productImages).where(inArray(productImages.productId, ids)),
    db.select().from(productBadges).where(inArray(productBadges.productId, ids)),
    db.select({ id: products.id, kind: sql<string>`kind::text` }).from(products).where(inArray(products.id, ids)),
  ]);
  const kindMap = new Map(kindRows.map((r) => [r.id, r.kind]));

  const { resolveVariants } = await import("@/server/repos/variant-resolver");
  const resolved = await resolveVariants(
    vars.map((v) => v.id),
    schoolId
  );

  // Slug-path lookup needs only {id, slug, parentId}. Pulling the whole
  // categories table on every render was unbounded; the cached map is fine
  // since categories change once-a-week at most.
  const { getCategoryMap } = await import("@/server/repos/categories");
  const catById = await getCategoryMap();
  const pathFor = (categoryId: string | null) => {
    if (!categoryId) return [] as string[];
    const out: string[] = [];
    let cur = catById.get(categoryId);
    while (cur) {
      out.unshift(cur.slug);
      cur = cur.parentId ? catById.get(cur.parentId) : undefined;
    }
    return out;
  };

  // Detect which kit products are parents of sibling "2nd lan" language variants.
  // e.g. "SAS Grade 10 Bookkit" is parent of "SAS Grade 10 BookkitHindi 2nd Lang".
  //
  // ⚠️  FRAGILE — match is by case-insensitive name-prefix only. Renaming a
  // kit (e.g. "Bookkit" → "Book Kit") or its language sibling will silently
  // break the language picker on the PDP. A proper fix would model the
  // parent ↔ sibling-language link explicitly (e.g. products.lang_parent_id
  // or a join table), but that's a schema change so it's left for later.
  const langChildNameLower = new Set(
    productRows
      .filter(({ product }) =>
        ['kit', 'set'].includes(kindMap.get(product.id) ?? '') &&
        product.name.toLowerCase().includes('2nd lan')
      )
      .map(({ product }) => product.name.toLowerCase())
  );
  const siblingLangParentIds = new Set<string>(
    productRows
      .filter(({ product }) => {
        const k = kindMap.get(product.id) ?? '';
        if (!['kit', 'set'].includes(k)) return false;
        if (product.name.toLowerCase().includes('2nd lan')) return false;
        const nameLower = product.name.toLowerCase();
        return [...langChildNameLower].some((child) => child.startsWith(nameLower));
      })
      .map(({ product }) => product.id)
  );

  const { parseBookkitLangs } = await import("@/lib/bookkit-langs");

  return productRows.map(({ product, ps }) => {
    const productImagesList = imgs
      .filter((i) => i.productId === product.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const productVariantsList = vars.filter((v) => v.productId === product.id);
    const totalStock = productVariantsList.reduce((s, v) => {
      const r = resolved.get(v.id);
      return s + (r?.available ?? 0);
    }, 0);
    const firstVariant = productVariantsList[0];
    const firstResolved = firstVariant ? resolved.get(firstVariant.id) : null;
    const pricePaise = firstResolved?.pricePaise ?? ps.overridePrice ?? product.basePrice;
    const mrpPaise = firstResolved?.mrpPaise ?? ps.overrideMrp ?? product.baseMrp;
    const productBadge = badges.find((b) => b.productId === product.id);
    const isKit = ['kit', 'set'].includes(kindMap.get(product.id) ?? '');
    const hasTemplateLang = isKit && parseBookkitLangs(
      productVariantsList.map((v) => ({ id: v.id, size: v.size, pricePaise: resolved.get(v.id)?.pricePaise ?? undefined }))
    ) !== null;
    // Multi-axis Item-Variant kits (e.g. SMS Grade 11 Bookkit with
    // Mandate × Core × Elective) have variants whose `size` column is
    // the full SKU string. We must NOT surface those as size pills on
    // the catalog card — picking is done on the PDP via the multi-axis
    // picker. Treat them like language-variant kits (hide pills + show
    // a "Choose options on the PDP" affordance).
    const attrGroups =
      (product.attributeGroups as { name: string; values: string[] }[] | null) ?? [];
    // Some catalog rows have variant `size` columns that hold concatenated
    // SKU strings (parent name + attribute values, e.g.
    // "SAS Suchitra Book Set Grade 12Grade 12 MandateCommerceApplied
    // Mathematics") rather than real apparel sizes. These should never
    // become size pills on the card — they look garbled and picking is
    // PDP-only via the multi-axis picker. Heuristics, applied to any
    // product (not just those tagged `kit`/`set`, because some bookkits
    // are misclassified as `uniform`):
    //   1. Variant size contains the parent product name prefix
    //   2. Variant size is suspiciously long (> 22 chars)
    //   3. The product has >= 2 attribute groups
    const nameLower = product.name.toLowerCase();
    const variantsLookLikeSkus = productVariantsList.some((v) => {
      const s = (v.size ?? "").trim();
      if (!s) return false;
      if (s.length > 22) return true;
      if (nameLower && s.toLowerCase().startsWith(nameLower.slice(0, 12)))
        return true;
      return false;
    });
    const isMultiAxisKit =
      (isKit && attrGroups.length >= 2) || variantsLookLikeSkus;
    const hasLangOptions =
      hasTemplateLang || siblingLangParentIds.has(product.id) || isMultiAxisKit;

    const catPath = pathFor(product.categoryId);
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      categoryPath: product.isMagicBox && catPath.length === 0 ? ["magic-box"] : catPath,
      price: rupeesFromPaise(pricePaise),
      mrp: mrpPaise != null ? rupeesFromPaise(mrpPaise) : null,
      // Drop the variant-SKU "sizes" array for multi-axis kits — those
      // strings are SKU names, not human-readable sizes.
      sizes: isMultiAxisKit
        ? []
        : cleanSizeLabels(productVariantsList.map((v) => v.size)),
      // Ground Stock decides (see the catalog list above).
      inStock: productVariantsList.length === 0 || totalStock > 0,
      badge: productBadge?.badge ?? null,
      img: safeImgUrl(ps.customImageUrl ?? productImagesList[0]?.url ?? null),
      required: ps.isRequired,
      isMagicBox: product.isMagicBox,
      // Treat misclassified bookkits (e.g. "SAS Suchitra Book Set Grade 12"
      // stored as `kind=uniform`) as kits on the card so the Add-to-cart
      // button routes to the PDP rather than calling `add(p, "")`.
      isKit: isKit || variantsLookLikeSkus,
      hasLangOptions:
        isKit || variantsLookLikeSkus ? hasLangOptions : undefined,
    } satisfies ProductCardDto;
  });
}

/**
 * Hydrate a full PDP DTO for the active student's school.
 *
 * ⚠️  CACHE STALENESS — the result is memoised for 300s, keyed per (slug,
 * schoolId). Admin edits to price / BOM / images don't appear until the
 * TTL expires. There is currently no invalidation hook on admin write
 * paths. If freshness becomes important, either drop the TTL here or wire
 * an explicit bust into the admin product/bundle update routes.
 */
/** Attach a colour label to each PDP image so the gallery can react to the
 *  shopper's colour pick. Explicit admin tag (attribute_value_id) wins;
 *  otherwise we look for a non-size attribute value inside the alt text —
 *  uploads are usually named after their colour ("Blue Sports polo front.jpg"),
 *  which covers products created before the tagging UI existed. Longest value
 *  first so "Sky Blue" beats "Blue". */
async function resolveImageColors(
  images: (typeof productImages.$inferSelect)[],
  attributeGroups: { name: string; values: string[] }[]
): Promise<{ id: string; url: string; alt: string | null; colorValue: string | null }[]> {
  const taggedIds = images
    .map((i) => i.attributeValueId)
    .filter((v): v is string => Boolean(v));
  const tagRows = taggedIds.length
    ? await db
        .select({ id: productAttributeValues.id, value: productAttributeValues.value })
        .from(productAttributeValues)
        .where(inArray(productAttributeValues.id, taggedIds))
    : [];
  const tagText = new Map(tagRows.map((r) => [r.id, r.value]));

  const candidateValues = attributeGroups
    .filter((g) => !/size|sizes/i.test(g.name))
    .flatMap((g) => g.values)
    .filter((v) => typeof v === "string" && v.length >= 3)
    .sort((a, b) => b.length - a.length);

  return images.map((i) => {
    let colorValue: string | null = null;
    if (i.attributeValueId) colorValue = tagText.get(i.attributeValueId) ?? null;
    if (!colorValue && i.alt) {
      const alt = i.alt.toLowerCase();
      colorValue =
        candidateValues.find((v) => alt.includes(v.toLowerCase())) ?? null;
    }
    return { id: i.id, url: safeImgUrl(i.url) ?? i.url, alt: i.alt, colorValue };
  });
}

export async function getProductBySlug(
  slug: string,
  schoolId?: string
): Promise<ProductDetailDto | null> {
  const cacheKey = `product:${slug}:${schoolId ?? "any"}`;
  // Very short TTL (5s) — admin writes invalidate this key on save. The
  // tiny ceiling absorbs duplicate requests during a single page render
  // without ever serving stale data.
  return cached(cacheKey, 5, async () => {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.slug, slug))
      .limit(1);
    if (!product) return null;

    const [variants, images, badges, ps] = await Promise.all([
      db
        .select()
        .from(productVariants)
        .where(
          and(
            eq(productVariants.productId, product.id),
            eq(productVariants.isActive, true)
          )
        ),
      db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, product.id))
        .orderBy(asc(productImages.sortOrder)),
      db.select().from(productBadges).where(eq(productBadges.productId, product.id)),
      schoolId
        ? db
            .select()
            .from(productSchool)
            .where(
              and(
                eq(productSchool.productId, product.id),
                eq(productSchool.schoolId, schoolId)
              )
            )
            .limit(1)
        : Promise.resolve([] as (typeof productSchool.$inferSelect)[]),
    ]);

    const psRow = ps[0];
    // Resolve from new system (bins/itemPrices) with legacy fallback.
    const { resolveVariants } = await import("@/server/repos/variant-resolver");
    const resolved = await resolveVariants(variants.map((v) => v.id), schoolId ?? null);

    // Bundle subtree — non-empty when this product is itself a bundle.
    // `kind` is not in the Drizzle schema; fetch it directly.
    const [[kindRow], bundleTree] = await Promise.all([
      db.execute(sql`SELECT kind::text AS kind FROM products WHERE id = ${product.id}`) as unknown as Promise<[{ kind: string }]>,
      loadBundleTree(product.id, schoolId ?? null),
    ]);
    const productKind = (kindRow as { kind?: string })?.kind ?? '';
    const kitLanguageVariants = productKind === 'kit'
      ? await loadKitLanguageVariants(product.id, schoolId ?? null)
      : [];
    const totalStock = variants.reduce((s, v) => {
      const r = resolved.get(v.id);
      return s + (r?.available ?? 0);
    }, 0);
    const firstVariant = variants[0];
    const firstResolved = firstVariant ? resolved.get(firstVariant.id) : null;
    const resolvedPricePaise = firstResolved?.pricePaise ?? psRow?.overridePrice ?? product.basePrice;
    const resolvedMrpPaise = firstResolved?.mrpPaise ?? psRow?.overrideMrp ?? product.baseMrp;

    // rating aggregate
    const ratingRows = await db
      .select({
        score: sql<number>`COALESCE(AVG(${reviews.rating}), 0)`,
        count: sql<number>`COUNT(${reviews.id})`,
      })
      .from(reviews)
      .where(
        and(eq(reviews.productId, product.id), eq(reviews.status, "approved"))
      );
    const ratingDist = await db
      .select({
        rating: reviews.rating,
        count: sql<number>`COUNT(${reviews.id})`,
      })
      .from(reviews)
      .where(
        and(eq(reviews.productId, product.id), eq(reviews.status, "approved"))
      )
      .groupBy(reviews.rating);

    const distribution = [5, 4, 3, 2, 1].map(
      (r) => Number(ratingDist.find((x) => x.rating === r)?.count ?? 0)
    );
    const score = Number(ratingRows[0]?.score ?? 0);
    const count = Number(ratingRows[0]?.count ?? 0);

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      categoryPath: await loadCategoryPath(product.categoryId),
      price: rupeesFromPaise(resolvedPricePaise),
      mrp: resolvedMrpPaise != null ? rupeesFromPaise(resolvedMrpPaise) : null,
      // Sizes stay populated — the BuyBox uses them to detect "looks
      // like SKU concatenation" and route to the multi-axis picker.
      // If we empty them here that detection fails and the user sees
      // "This product currently has no available sizes."
      sizes: cleanSizeLabels(variants.map((v) => v.size)),
      // Ground Stock decides: in stock while any size can be bought.
      inStock: variants.length === 0 || totalStock > 0,
      badge: badges[0]?.badge ?? null,
      img: safeImgUrl(psRow?.customImageUrl ?? images[0]?.url ?? null),
      required: psRow?.isRequired ?? false,
      tagline: product.tagline,
      description: (product.description as string[] | null) ?? null,
      specs:
        (product.specs as { label: string; value: string }[] | null) ?? null,
      sizeTable:
        (product.sizeTable as
          | { size: string; chest: string; length: string; sleeve: string }[]
          | null) ?? null,
      sizeChartUrl: safeImgUrl(product.sizeChartUrl ?? null),
      imageNote: (product.imageNote as string | null) ?? null,
      variants: variants.map((v) => {
        const r = resolved.get(v.id);
        const pricePaise = r?.pricePaise ?? resolvedPricePaise;
        return {
          id: v.id,
          size: v.size,
          sku: v.sku,
          // Resolver figure only — never the legacy column.
          stockQty: r?.available ?? 0,
          pricePaise,
          mrpPaise: r?.mrpPaise ?? resolvedMrpPaise,
          // Explicit ₹0 item_prices rows are real prices (school-included
          // freebies) — only "no row + zero fallback" counts as unpriced.
          priced: (r?.explicitPrice ?? false) || pricePaise > 0,
        };
      }),
      templateVariants: await loadTemplateVariants(product.id),
      attributeGroups:
        (product.attributeGroups as { name: string; values: string[] }[] | null) ??
        [],
      variantsByAttributeKey: await loadVariantsByAttributeKey(product.id),
      // Intentionally null. We previously fell back to a sibling-grade kit
      // image, but that showed the Grade 10 kit photo on a Grade 11 PDP
      // (visually misleading). The PDP renders a stylized placeholder card
      // when this is null — better to show no photo than a wrong photo.
      fallbackImageUrl: null,
      images: await resolveImageColors(
        images,
        (product.attributeGroups as { name: string; values: string[] }[] | null) ?? []
      ),
      rating: count > 0 ? { score, count, distribution } : null,
      bundleTree,
      isBundle: bundleTree.length > 0,
      isMagicBox: product.isMagicBox,
      kind: productKind || 'unknown',
      kitLanguageVariants,
    } satisfies ProductDetailDto;
  });
}

/**
 * Build a BOM tree for a template variant (e.g. "SAS Suchitra Grade 7 BookkitHindi 2nd Lan Tel 3rd Lan")
 * that has no corresponding product row in the DB.
 *
 * Strategy:
 *  1. Look for a product whose name exactly matches the variant SKU → use its bundle tree.
 *  2. Otherwise parse grade + language from the SKU and fuzzy-search for the expected
 *     child sub-bundles (Mandate Textbook, Language sub-bundle, Notebook, Stationery…),
 *     then load each child's own subtree via loadBundleTree and stitch them together.
 */
export async function loadVariantBundleTree(
  variantId: string,
  schoolId: string | null
): Promise<BundleNode[]> {
  // Step 0: get the variant SKU (= full ERPNext item name)
  const variantRows = (await db.execute(sql`
    SELECT sku FROM product_variants WHERE id = ${variantId}
  `)) as unknown as { sku: string }[];
  if (!variantRows.length) return [];
  const sku = variantRows[0].sku;

  // Step 1: exact product name match → normal bundle tree
  const exactRows = (await db.execute(sql`
    SELECT id FROM products WHERE name = ${sku} AND status = 'active' LIMIT 1
  `)) as unknown as { id: string }[];
  if (exactRows.length) {
    return loadBundleTree(exactRows[0].id, schoolId);
  }

  // Step 2: parse SKU to derive child search patterns
  // Pattern: "{School} {Campus} Grade {N} Bookkit{Lang} 2nd Lan {ThirdAbbr} 3rd Lan"
  // \s* allows "Bookkit Hindi" (space) as well as "BookkitHindi" (no space)
  const gradeMatch = sku.match(/Grade\s+(\d+)/i);
  const langMatch  = sku.match(/bookkit\s*(\w+)/i);
  if (!gradeMatch || !langMatch) return [];

  const gradeNum = gradeMatch[1];   // e.g. "7"
  const language = langMatch[1];    // e.g. "Hindi"

  // Everything before "Grade" gives us the school + optional campus.
  // e.g. "SAS Suchitra Grade 7…" → beforeGrade="SAS Suchitra", schoolCode="SAS", campusName="Suchitra"
  //      "WM JK Grade 7…"        → beforeGrade="WM JK",         schoolCode="WM",  campusName="JK"
  //      "SMS Grade 7…"          → beforeGrade="SMS",            schoolCode="SMS", campusName=""
  const beforeGrade = sku.split(/\s+Grade\s+/i)[0].trim();
  const [schoolCode, campusName = ''] = beforeGrade.split(/\s+/);

  // Campus-name → ERP campus-code used in product names (e.g. "Suchitra" → "BP")
  const CAMPUS_CODE: Record<string, string> = {
    Suchitra: 'BP', Bholakpur: 'BP',
    Keesara: 'KS',
    Whitefield: 'WF',
    JK: 'JK', Jalahalli: 'JK',
    Nagarbhavi: 'NB',
    Kengeri: 'KG',
  };
  const campusCode = CAMPUS_CODE[campusName] ?? campusName; // "JK" maps to itself

  // campusPfx: used in product names for campus-specific children
  // "SAS" + "BP" → "SAS BP" | "WM" + "JK" → "WM JK" | "SMS" + "" → "SMS"
  const campusPfx = campusCode ? `${schoolCode} ${campusCode}` : schoolCode;

  // ------------------------------------------------------------------
  // Search patterns derived from the ERPNext BOM structure:
  //
  //  Child type      | SAS BP example          | WM JK example           | SMS example
  //  ----------------|-------------------------|-------------------------|------------------
  //  Mandate         | Grade 7 Mandate Textbook| Grade 7 Mandate Textbook| Grade 7 Mandate Textbook
  //  Language bundle | SAS Grade 7 Hindi       | WM WF Grade 7 Hindi*    | SMS Grade 7 Hindi
  //  Notebook        | SAS Grade 7 Notebook    | WM Grade 7 Notebook     | SMS Grade 7 Notebook
  //  Stationery(g)   | SAS BP Grade 7 Station. | WM Grade 7 Stationery   | SMS Grade 7 Stationery
  //  Stationery(c)   | —                       | WM JK Stationery        | —
  //  Program         | SAS Program             | WM JK Grade 7 Program   | SMS Program
  //                  |                         | WM Program Grade 7      |
  //  Other           | SAS Suchitra Other      | WM JK Other MS          | SMS Other
  //
  //  * WM JK Grade 1-8 Hindi/Kannada are only synced as "WM WF Grade N Hindi/Kannada".
  //    schoolCode%Grade N Language matches both "WM WF…" and "WM JK…" (when it exists).
  // ------------------------------------------------------------------

  const pMandate      = `Grade ${gradeNum} Mandate Textbook`;
  // Language: schoolCode + any campus + grade + exact language name (no trailing %)
  const pLang         = `${schoolCode}%Grade ${gradeNum} ${language}`;
  // Notebook: schoolCode + any campus + grade + "Notebook" (exact end)
  const pNotebook     = `${schoolCode}%Grade ${gradeNum} Notebook`;
  // Stationery: campus-specific with grade; school-level fallback when no campus variant
  const pStatCampus   = `${campusPfx} Grade ${gradeNum}%Stationery%`;
  const pStatSchool   = `${schoolCode} Grade ${gradeNum}%Stationery%`;
  // Program: no-grade version ("SAS Program") + grade-before-keyword ("WM JK Grade 7 Program")
  //          + grade-after-keyword ("WM Program Grade 7")
  const pProgram1     = `${schoolCode}%Program%`;       // school-level, further filtered with NOT ILIKE '%Grade%'
  const pProgram2     = `${schoolCode}%Grade ${gradeNum}%Program%`;
  const pProgram3     = `${schoolCode}%Program%Grade ${gradeNum}%`;
  // Other: use campus-NAME form (e.g. "SAS Suchitra Other", "WM JK Other MS")
  //        Only matches products where "Other" follows IMMEDIATELY after the campus prefix
  //        (no grade number between prefix and "Other"), preventing wrong-grade matches.
  const pOtherExact   = `${beforeGrade} Other%`;
  // Optional: also match campus + grade + Other (e.g. "WM JK Grade 7 Other" if it exists)
  const pOtherGrade   = `${beforeGrade} Grade ${gradeNum}%Other%`;

  const childRows = (await db.execute(sql`
    SELECT p.id, p.name, p.slug, p.kind::text AS kind, p.base_price, p.base_mrp,
           ps.override_price, ps.override_mrp,
           (SELECT url FROM product_images WHERE product_id = p.id
             ORDER BY is_primary DESC NULLS LAST, sort_order ASC LIMIT 1) AS img,
           ps.custom_image_url AS override_img
    FROM products p
    LEFT JOIN product_school ps ON ps.product_id = p.id AND ps.school_id = ${schoolId}
    WHERE p.status = 'active' AND p.kind::text = 'sub_bundle'
      AND (
        p.name ILIKE ${pMandate}
        OR p.name ILIKE ${pLang}
        OR p.name ILIKE ${pNotebook}
        -- Stationery: campus-specific; school-level only when no campus variant exists
        OR p.name ILIKE ${pStatCampus}
        OR (p.name ILIKE ${pStatSchool}
            AND NOT EXISTS (
              SELECT 1 FROM products sq WHERE sq.status = 'active'
                AND sq.kind::text = 'sub_bundle' AND sq.name ILIKE ${pStatCampus}
            ))
        -- Program (no-grade school-level, or grade-specific in either word order)
        OR (p.name ILIKE ${pProgram1} AND p.name NOT ILIKE '%Grade%')
        OR p.name ILIKE ${pProgram2}
        OR p.name ILIKE ${pProgram3}
        -- Other: "before-grade prefix" + "Other" immediately (no stray grade words)
        OR p.name ILIKE ${pOtherExact}
        OR p.name ILIKE ${pOtherGrade}
      )
    ORDER BY p.name
  `)) as unknown as {
    id: string; name: string; slug: string; kind: string;
    base_price: number; base_mrp: number | null;
    override_price: number | null; override_mrp: number | null;
    img: string | null; override_img: string | null;
  }[];

  if (!childRows.length) return [];

  // Load sub-trees for each child, then wrap them as top-level BundleNodes
  const nodes: BundleNode[] = await Promise.all(
    childRows.map(async (c, idx) => {
      const children = await loadBundleTree(c.id, schoolId);
      return {
        componentId: `virtual-${variantId}-${idx}`,
        productId: c.id,
        slug: c.slug,
        name: c.name,
        bundleLevel: c.kind,
        qty: 1,
        pricePaise: c.override_price ?? c.base_price,
        mrpPaise: c.override_mrp ?? c.base_mrp,
        img: safeImgUrl(c.override_img ?? c.img ?? null),
        isOptional: false,
        selectorGroupKey: null,
        selectorOptionLabel: null,
        children,
      } satisfies BundleNode;
    })
  );

  return nodes;
}

export async function listAllSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: products.slug })
    .from(products)
    .where(eq(products.status, "active"));
  return rows.map((r) => r.slug);
}
