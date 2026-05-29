import "server-only";
/**
 * Transactional helpers for the guided "Create new item" wizard at
 * `/admin/catalog/build`. Each helper validates its payload, runs in one
 * db.transaction, and returns the new parent productId.
 *
 * These helpers are also designed to be reusable by the legacy
 * /admin/products/new POST handler — its current behaviour writes a
 * subset of what these do, and could be migrated later for one canonical
 * insert path. Phase 1 deliberately did not touch the POST handler beyond
 * the minimum needed to set `kind` + multi-school/grade so we keep two
 * inserters during the wizard rollout; once it ships we'll converge.
 *
 * NB: helpers run only inside a transaction. No `revalidatePath()` — the
 * caller server action owns cache invalidation.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bundleComponents,
  productAttributeBindings,
  productBundles,
  productGrades,
  productSchool,
  productVariantAttributes,
  productVariants,
  products,
} from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ───────────────────────── shared utilities ─────────────────────────

/** kebab-cased slug derived from name. Collisions are resolved with a
 *  short random suffix; the column has a unique index. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return base || "item";
}

async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  const candidate = slugify(base);
  const existing = await tx
    .select({ slug: products.slug })
    .from(products)
    .where(eq(products.slug, candidate))
    .limit(1);
  if (existing.length === 0) return candidate;
  // Suffix with a 6-char random nibble. Loop once is enough in practice;
  // if the suffix also collides, the unique index will throw and the
  // caller can retry.
  const suf = Math.random().toString(36).slice(2, 8);
  return `${candidate}-${suf}`.slice(0, 80);
}

/** Three-letter abbreviation for the 3rd-language token in bookkit
 *  variant size strings. Mirror of LANG_ABBR in lib/bookkit-langs.ts but
 *  inverted; kept duplicated here to avoid a forced bidirectional import. */
const LANG_TO_ABBR: Record<string, string> = {
  Hindi: "Hin", Telugu: "Tel", Kannada: "Kan", Sanskrit: "San",
  Marathi: "Mar", Tamil: "Tam", Malayalam: "Mal", Urdu: "Urd",
  English: "Eng", Bengali: "Ben", Punjabi: "Pun", Gujarati: "Guj",
  Odia: "Ori", French: "Fre", Assamese: "Ass", Kashmiri: "Kas",
  Konkani: "Kon", Nepali: "Nep", Sindhi: "Sin",
};

// ───────────────────────── bookkit ─────────────────────────

export type LeafChildPayload = {
  kind: "new_leaf";
  name: string;
  slug?: string;
  basePrice: number; // rupees
  productKind: "book" | "consumable" | "accessory";
  categoryId?: string | null;
  qty: number;
  isOptional?: boolean;
};

export type SubBundleChildPayload = {
  kind: "new_sub_bundle";
  name: string;
  slug?: string;
  basePrice: number; // rupees
  categoryId?: string | null;
  /** Recursive: a sub-bundle can contain leaves or further sub-bundles. */
  children: BookkitChildPayload[];
  qty: number;
  isOptional?: boolean;
};

export type ExistingChildPayload = {
  kind: "existing";
  productId: string;
  qty: number;
  isOptional?: boolean;
};

export type BookkitChildPayload =
  | LeafChildPayload
  | SubBundleChildPayload
  | ExistingChildPayload;

export type LanguageComboPayload = {
  /** Full 2nd-language name, e.g. "Hindi". */
  secondLang: string;
  /** Full 3rd-language name, e.g. "Telugu". Omit/blank for trailing-pattern
   *  variants (handled by parseBookkitLangs pattern B). */
  thirdLang?: string | null;
  /** Optional per-variant SKU. Auto-derived when omitted. */
  sku?: string;
};

export type BookkitPayload = {
  // identify
  name: string;
  slug?: string;
  categoryId?: string | null;
  basePrice: number; // rupees
  baseMrp?: number | null; // rupees
  status: "active" | "draft" | "archived";
  // schools + grades
  schoolIds: string[];
  grades: string[];
  // children
  children: BookkitChildPayload[];
  // Pick ONE variant style. `languageVariants` matches the
  // parseBookkitLangs name patterns; `multiAxis` plugs into the same
  // product_attributes / product_variant_attributes pipeline the Uniform
  // flow uses, so the PDP's MultiAttributePicker renders it without any
  // changes. Both fields are optional — a kit with no variants is also
  // valid (one fixed SKU).
  languageVariants?: LanguageComboPayload[];
  multiAxis?: {
    axes: AxisPayload[];
    variants: VariantRowPayload[];
  };
};

/**
 * Insert one bundle_component row, recursively materialising new
 * sub-bundles and new leaves as needed. Returns the productId that the
 * component points at (existing or freshly minted).
 */
async function insertBookkitChild(
  tx: Tx,
  parentBundleId: string,
  child: BookkitChildPayload,
  depth: number,
): Promise<string> {
  if (depth > 6) {
    // Defensive: matches BUNDLE_TREE_MAX_DEPTH in lib/repos/products.ts.
    throw new Error("Sub-bundle nesting exceeds 6 levels");
  }
  let childProductId: string;
  if (child.kind === "existing") {
    childProductId = child.productId;
  } else if (child.kind === "new_leaf") {
    const slug = await uniqueSlug(tx, child.slug ?? child.name);
    const [row] = await tx
      .insert(products)
      .values({
        name: child.name,
        slug,
        basePrice: Math.round(child.basePrice * 100),
        baseMrp: null,
        categoryId: child.categoryId ?? null,
        status: "active",
        kind: child.productKind,
        isMagicBox: false,
      })
      .returning({ id: products.id });
    childProductId = row.id;
  } else {
    // new_sub_bundle — insert the parent product, its product_bundles
    // row, then recurse into grandchildren.
    const slug = await uniqueSlug(tx, child.slug ?? child.name);
    const [row] = await tx
      .insert(products)
      .values({
        name: child.name,
        slug,
        basePrice: Math.round(child.basePrice * 100),
        baseMrp: null,
        categoryId: child.categoryId ?? null,
        status: "active",
        kind: "sub_bundle",
        isMagicBox: false,
      })
      .returning({ id: products.id });
    childProductId = row.id;
    const [bundleRow] = await tx
      .insert(productBundles)
      .values({ productId: childProductId, bundleType: "fixed" })
      .returning({ id: productBundles.id });
    for (const gc of child.children) {
      await insertBookkitChild(tx, bundleRow.id, gc, depth + 1);
    }
  }
  await tx.insert(bundleComponents).values({
    bundleId: parentBundleId,
    productId: childProductId,
    qty: child.qty || 1,
    isOptional: child.isOptional ?? false,
  });
  return childProductId;
}

export type CreateBookkitResult = {
  productId: string;
  bundleId: string;
  childProductIds: string[];
  variantIds: string[];
};

export async function createBookkitWithBom(
  payload: BookkitPayload,
): Promise<CreateBookkitResult> {
  if (payload.languageVariants?.length && payload.multiAxis) {
    throw new Error(
      "Pick either language variants OR a multi-axis matrix, not both — they produce overlapping product_variants rows.",
    );
  }
  return db.transaction(async (tx) => {
    // attribute_groups JSONB is set up-front so the PDP renders the
    // MultiAttributePicker without an extra join when multi-axis is in
    // play. Language-only and no-variant kits leave the column null.
    const attrGroups =
      payload.multiAxis?.axes.map((a) => ({
        name: a.attributeName,
        values: a.values.map((v) => v.label),
      })) ?? null;

    // 1. Parent product
    const slug = await uniqueSlug(tx, payload.slug ?? payload.name);
    const [parent] = await tx
      .insert(products)
      .values({
        name: payload.name,
        slug,
        basePrice: Math.round(payload.basePrice * 100),
        baseMrp: payload.baseMrp != null ? Math.round(payload.baseMrp * 100) : null,
        categoryId: payload.categoryId ?? null,
        status: payload.status,
        kind: "kit",
        isMagicBox: false,
        attributeGroups: attrGroups,
      })
      .returning({ id: products.id });

    // 2. School + grade visibility
    if (payload.schoolIds.length > 0) {
      await tx
        .insert(productSchool)
        .values(payload.schoolIds.map((schoolId) => ({ productId: parent.id, schoolId })))
        .onConflictDoNothing();
    }
    if (payload.grades.length > 0) {
      await tx
        .insert(productGrades)
        .values(payload.grades.map((grade) => ({ productId: parent.id, grade })))
        .onConflictDoNothing();
    }

    // 3. Parent BOM
    const [parentBundle] = await tx
      .insert(productBundles)
      .values({ productId: parent.id, bundleType: "fixed" })
      .returning({ id: productBundles.id });

    // 4. Children
    const childProductIds: string[] = [];
    for (const child of payload.children) {
      const cpId = await insertBookkitChild(tx, parentBundle.id, child, 0);
      childProductIds.push(cpId);
    }

    // 5. Language variants encoded into product_variants.size in the
    //    exact pattern parseBookkitLangs expects. SKU defaults to
    //    slug-uppercased + abbreviations so each row is unique.
    const variantIds: string[] = [];
    if (payload.languageVariants && payload.languageVariants.length > 0) {
      for (const combo of payload.languageVariants) {
        const second = combo.secondLang.trim();
        const third = (combo.thirdLang ?? "").trim();
        const thirdAbbr = third ? LANG_TO_ABBR[third] ?? third.slice(0, 3) : null;
        // Pattern A (with 3rd language):
        //   "<Parent Name>Bookkit<Second> 2nd Lan <ThirdAbbr> 3rd Lan"
        // Pattern B (trailing language only):
        //   "<Parent Name>Bookkit<Second>"
        //
        // We anchor "Bookkit" into the size string regardless of whether
        // the parent name already ends with "Bookkit", because the parser
        // matches case-insensitively against the literal substring.
        const sizeBase = /bookkit/i.test(payload.name)
          ? payload.name.replace(/\s*$/, "")
          : `${payload.name} Bookkit`;
        const size = thirdAbbr
          ? `${sizeBase}${second} 2nd Lan ${thirdAbbr} 3rd Lan`
          : `${sizeBase}${second}`;
        const sku = combo.sku?.trim() ||
          `${slug.toUpperCase().replace(/-/g, "")}-${second.slice(0, 3).toUpperCase()}${thirdAbbr ? "-" + thirdAbbr.toUpperCase() : ""}`;
        const [v] = await tx
          .insert(productVariants)
          .values({
            productId: parent.id,
            size,
            sku,
            stockQty: 0,
            isActive: true,
          })
          .returning({ id: productVariants.id });
        variantIds.push(v.id);
      }
    }

    // 6. Multi-axis variants (mutually exclusive with language variants).
    //    Writes the same row-set the Uniform builder writes — attribute
    //    bindings, one product_variant per axis combo, and one
    //    product_variant_attributes row per axis-per-variant.
    if (payload.multiAxis) {
      const { axes, variants: axisVariants } = payload.multiAxis;
      if (axes.length === 0) throw new Error("Multi-axis kit needs at least one axis");
      if (axisVariants.length === 0) throw new Error("Multi-axis kit needs at least one variant");
      await tx
        .insert(productAttributeBindings)
        .values(
          axes.map((a, idx) => ({
            productId: parent.id,
            attributeId: a.attributeId,
            sortOrder: idx,
            isRequired: true,
          })),
        )
        .onConflictDoNothing();
      for (const v of axisVariants) {
        if (v.axisValueIds.length !== axes.length) {
          throw new Error("Variant axis count mismatches axes definition");
        }
        const [row] = await tx
          .insert(productVariants)
          .values({
            productId: parent.id,
            size: v.sizeLabel,
            sku: v.sku,
            stockQty: v.stockQty,
            isActive: v.isActive,
          })
          .returning({ id: productVariants.id });
        variantIds.push(row.id);
        await tx.insert(productVariantAttributes).values(
          v.axisValueIds.map((valueId, idx) => ({
            variantId: row.id,
            attributeId: axes[idx].attributeId,
            valueId,
          })),
        );
      }
    }

    return {
      productId: parent.id,
      bundleId: parentBundle.id,
      childProductIds,
      variantIds,
    };
  });
}

// ───────────────────────── uniform (multi-axis) ─────────────────────────

/**
 * One axis on the variants matrix — references an existing
 * `product_attributes` row plus the ordered subset of values from that
 * attribute the admin wants on this particular product.
 */
export type AxisPayload = {
  attributeId: string;
  /** Display name of the attribute (stored in attribute_groups JSONB on
   *  the product so the PDP renders the picker without an extra query). */
  attributeName: string;
  values: { valueId: string; label: string }[];
};

/**
 * Concrete (sizes × colours × …) combination the matrix produced.
 * `axisValueIds` is in the same order as `axes` on the payload so the
 * builder can zip them when writing `product_variant_attributes`.
 */
export type VariantRowPayload = {
  axisValueIds: string[];
  /** Human label, e.g. "White · 30". Persisted to product_variants.size. */
  sizeLabel: string;
  sku: string;
  stockQty: number;
  isActive: boolean;
};

export type UniformPayload = {
  name: string;
  slug?: string;
  categoryId?: string | null;
  basePrice: number;
  baseMrp?: number | null;
  status: "active" | "draft" | "archived";
  schoolIds: string[];
  grades: string[];
  axes: AxisPayload[];
  variants: VariantRowPayload[];
  /** Optional override of the product kind. Defaults to 'uniform' for the
   *  Uniform flow; the multi-axis Bookkit reuse will pass 'kit'. */
  kind?: "uniform" | "kit" | "accessory";
};

export type CreateUniformResult = {
  productId: string;
  variantIds: string[];
};

export async function createUniformWithVariants(
  payload: UniformPayload,
): Promise<CreateUniformResult> {
  if (payload.axes.length === 0) throw new Error("At least one axis is required");
  if (payload.variants.length === 0) throw new Error("At least one variant is required");

  return db.transaction(async (tx) => {
    // 1. Parent product. attribute_groups is set so the PDP can render
    //    its picker straight off the row, no extra join required.
    const attrGroups = payload.axes.map((a) => ({
      name: a.attributeName,
      values: a.values.map((v) => v.label),
    }));
    const slug = await uniqueSlug(tx, payload.slug ?? payload.name);
    const [parent] = await tx
      .insert(products)
      .values({
        name: payload.name,
        slug,
        basePrice: Math.round(payload.basePrice * 100),
        baseMrp: payload.baseMrp != null ? Math.round(payload.baseMrp * 100) : null,
        categoryId: payload.categoryId ?? null,
        status: payload.status,
        kind: payload.kind ?? "uniform",
        isMagicBox: false,
        attributeGroups: attrGroups,
      })
      .returning({ id: products.id });

    // 2. School + grade visibility.
    if (payload.schoolIds.length > 0) {
      await tx
        .insert(productSchool)
        .values(payload.schoolIds.map((schoolId) => ({ productId: parent.id, schoolId })))
        .onConflictDoNothing();
    }
    if (payload.grades.length > 0) {
      await tx
        .insert(productGrades)
        .values(payload.grades.map((grade) => ({ productId: parent.id, grade })))
        .onConflictDoNothing();
    }

    // 3. Attribute bindings (one per axis), preserving sort order.
    await tx
      .insert(productAttributeBindings)
      .values(
        payload.axes.map((a, idx) => ({
          productId: parent.id,
          attributeId: a.attributeId,
          sortOrder: idx,
          isRequired: true,
        })),
      )
      .onConflictDoNothing();

    // 4. Variants + per-variant attribute mappings.
    const variantIds: string[] = [];
    for (const v of payload.variants) {
      if (v.axisValueIds.length !== payload.axes.length) {
        throw new Error("Variant axis count mismatches axes definition");
      }
      const [row] = await tx
        .insert(productVariants)
        .values({
          productId: parent.id,
          size: v.sizeLabel,
          sku: v.sku,
          stockQty: v.stockQty,
          isActive: v.isActive,
        })
        .returning({ id: productVariants.id });
      variantIds.push(row.id);
      await tx.insert(productVariantAttributes).values(
        v.axisValueIds.map((valueId, idx) => ({
          variantId: row.id,
          attributeId: payload.axes[idx].attributeId,
          valueId,
        })),
      );
    }

    return { productId: parent.id, variantIds };
  });
}

