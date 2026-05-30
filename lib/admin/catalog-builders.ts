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
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  bundleComponents,
  bundleSelectors,
  itemPrices,
  priceLists,
  productAttributeBindings,
  productAttributeValues,
  productAttributes,
  productBundles,
  productGrades,
  productSchool,
  productVariantAttributes,
  productVariants,
  products,
} from "@/db/schema";

/** Canonical attribute names for the guided streams flow. Keeps every
 *  wizard-created Bookkit pointing at the same shared `Stream` /
 *  `Language` / `Elective 1` / `Elective 2` attribute rows (one per
 *  name in the whole catalog), so multiple kits aggregate cleanly under
 *  `/admin/catalog/attributes`. */
const GS_NAMES = {
  stream: "Stream",
  language: "Language",
  elective1: "Elective 1",
  elective2: "Elective 2",
} as const;

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

/**
 * Case-insensitive name lookup; create a row if absent. Used by the
 * guided-streams flow so canonical names like `Stream` / `Language`
 * silently reuse the existing rows admins (or earlier wizard runs)
 * already created. Returns the attribute id + name (DB casing wins
 * over the caller's casing, e.g. "stream" → existing "Stream").
 */
async function lookupOrCreateAttribute(
  tx: Tx,
  name: string,
  type: "size" | "color" | "design" | "model" | "other",
): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();
  const [existing] = await tx
    .select({ id: productAttributes.id, name: productAttributes.name })
    .from(productAttributes)
    .where(eq(sql`lower(${productAttributes.name})`, trimmed.toLowerCase()))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(productAttributes)
    .values({ name: trimmed, type, schoolId: null, sortOrder: 0 })
    .returning({ id: productAttributes.id, name: productAttributes.name });
  return created;
}

/**
 * Resolve a list of value labels under one attribute, creating any that
 * don't already exist. Returns a Map keyed by the input label (verbatim)
 * pointing at the value id. Case-insensitive match — if an admin typed
 * "biology" but the catalog has "Biology", the existing row wins.
 */
async function lookupOrCreateValues(
  tx: Tx,
  attributeId: string,
  labels: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (labels.length === 0) return result;
  const distinct = Array.from(new Set(labels.map((l) => l.trim()).filter((l) => l.length > 0)));
  if (distinct.length === 0) return result;
  const lowerSet = distinct.map((l) => l.toLowerCase());
  const existing = await tx
    .select({
      id: productAttributeValues.id,
      value: productAttributeValues.value,
      displayLabel: productAttributeValues.displayLabel,
    })
    .from(productAttributeValues)
    .where(
      sql`${productAttributeValues.attributeId} = ${attributeId} AND lower(${productAttributeValues.value}) IN (${sql.join(
        lowerSet.map((l) => sql`${l}`),
        sql`, `,
      )})`,
    );
  const lowerToId = new Map<string, string>();
  for (const r of existing) lowerToId.set(r.value.toLowerCase(), r.id);
  for (const label of distinct) {
    const lower = label.toLowerCase();
    let id = lowerToId.get(lower);
    if (!id) {
      const [created] = await tx
        .insert(productAttributeValues)
        .values({ attributeId, value: label, sortOrder: 0 })
        .returning({ id: productAttributeValues.id });
      id = created.id;
      lowerToId.set(lower, id);
    }
    result.set(label, id);
  }
  return result;
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
  /**
   * Sibling-kit-per-combo wiring. When present, instead of writing
   * `product_variants` rows on the template (current `languageVariants`
   * path), the builder writes one full sibling-kit product per combo with
   * `variant_of_product_id = template.id`, `is_variant_item = true`, and
   * its own `product_bundles` + `bundle_components` populated from
   * `bomByCombo[k]`. The storefront's `loadKitLanguageVariants` picks
   * these up directly — no name-pattern matching needed.
   *
   * Combo key shape is `${secondLang}||${thirdLang}` (thirdLang is "" when
   * only a 2nd language is selected). Prices are in PAISE.
   */
  languageCombos?: {
    bomByCombo?: Record<string, BookkitChildPayload[]>;
    pricesByCombo?: Record<string, number>;
  };
  multiAxis?: BookkitMultiAxisPayload;
};

/**
 * `flat` writes the cartesian product of every axis × every value (current
 * behaviour). `stream` writes a per-stream sub-cartesian, plus per-stream
 * `bundle_components` tagged with selector_group_key so the bundle engine
 * expands the right auto-included items at checkout. The PDP's
 * MultiAttributePicker filters child-axis chips automatically because
 * we only write variant rows for valid stream-conditional combinations.
 */
export type BookkitMultiAxisPayload =
  | {
      mode: "flat";
      axes: AxisPayload[];
      variants: VariantRowPayload[];
    }
  | {
      /** Guided Streams + Languages + Electives flow — replaces the
       *  abstract Phase 2c "stream" mode. The admin types domain names
       *  (Science / English / Biology) directly; the builder resolves
       *  them to product_attributes / product_attribute_values rows via
       *  case-insensitive lookup-or-create, then generates one
       *  product_variants row per valid combination. Per-stream
       *  mandates become bundle_components tagged with
       *  selector_group_key='Stream' + selector_option_label=<stream>.
       *
       *  All four axes are independently optional. Disabled axes are
       *  skipped from variant_attributes / attribute_groups entirely
       *  (no empty-string placeholder rows). If all four are disabled
       *  the wizard should never have selected this mode — the builder
       *  refuses with "Pick at least one axis". */
      mode: "guidedStreams";
      /** Stream label list (e.g. `["Science","Commerce","Humanities"]`).
       *  Empty array disables the Stream axis. Max 7 enforced by Zod. */
      streams?: string[];
      /** Language label list. Empty disables the Language axis. */
      languages?: string[];
      /** Per-stream mandate items. Key is the stream label (matches
       *  `streams[*]`). Reuses the standard BookkitChildPayload union so
       *  the builder can call insertStreamScopedChild straight through. */
      mandatesPerStream?: Record<string, BookkitChildPayload[]>;
      /** Elective 1 subject labels per combo. Combo key is
       *  `${stream}||${language}` where each side is "" when the matching
       *  axis is disabled. Distinct subject labels are collected across
       *  combos to form the Elective 1 attribute's value list. */
      elective1?: Record<string, string[]>;
      /** Elective 2 — same shape as elective1. */
      elective2?: Record<string, string[]>;
      /** Optional per-combo price overrides in PAISE. Combo key shape is
       *  `${stream}||${language}||${elective1}||${elective2}` with empty
       *  string for each disabled axis. Combos not present in this map
       *  fall back to the parent product's basePrice via the storefront
       *  variant resolver. Written as item_prices rows on the default
       *  selling price list with school_id NULL. */
      pricesByCombo?: Record<string, number>;
    };

/**
 * Insert one bundle_component row, recursively materialising new
 * sub-bundles and new leaves as needed. Returns the productId that the
 * component points at (existing or freshly minted).
 */
/**
 * Variant of `insertBookkitChild` that tags the top-level
 * `bundle_components` row with `selector_group_key` + `selector_option_label`
 * so the bundle engine expands it only when the parent's selector picks
 * the matching value. Used by the stream-driven Bookkit mode to
 * auto-include per-stream Compulsory subjects (e.g. Physics+Chemistry for
 * Stream=Science) without requiring the parent to pick them explicitly.
 *
 * Nested sub-bundle rows (rows at depth > 0) are NOT tagged — those are
 * children of the auto-included sub-bundle, not of the kit itself, so
 * tagging would short-circuit the bundle engine's selector logic.
 */
async function insertStreamScopedChild(
  tx: Tx,
  parentBundleId: string,
  child: BookkitChildPayload,
  selectorScope: { groupKey: string; optionLabel: string },
  depth: number,
): Promise<string> {
  if (depth > 6) throw new Error("Sub-bundle nesting exceeds 6 levels");
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
      // grandchildren go through the untagged helper — they're scoped to
      // this sub-bundle, not the stream selector.
      await insertBookkitChild(tx, bundleRow.id, gc, depth + 1);
    }
  }
  await tx.insert(bundleComponents).values({
    bundleId: parentBundleId,
    productId: childProductId,
    qty: child.qty || 1,
    isOptional: child.isOptional ?? false,
    selectorGroupKey: selectorScope.groupKey,
    selectorOptionLabel: selectorScope.optionLabel,
  });
  return childProductId;
}

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
    // play. For `mode='stream'` we union the streamAxis + every childAxis
    // (full set per axis — the picker filters via computeAvailableByAxis
    // at read time, not at write time). Language-only and no-variant
    // kits leave the column null.
    let attrGroups: { name: string; values: string[] }[] | null = null;
    if (payload.multiAxis?.mode === "flat") {
      attrGroups = payload.multiAxis.axes.map((a) => ({
        name: a.attributeName,
        values: a.values.map((v) => v.label),
      }));
    } else if (payload.multiAxis?.mode === "guidedStreams") {
      // Build the attribute_groups JSONB up-front from the typed labels.
      // The PDP's MultiAttributePicker reads attribute_groups directly
      // and filters chip rows via computeAvailableByAxis once variants
      // are loaded — no extra join needed.
      const ax = payload.multiAxis;
      attrGroups = [];
      if (ax.streams && ax.streams.length > 0) {
        attrGroups.push({ name: GS_NAMES.stream, values: [...ax.streams] });
      }
      if (ax.languages && ax.languages.length > 0) {
        attrGroups.push({ name: GS_NAMES.language, values: [...ax.languages] });
      }
      if (ax.elective1) {
        const v = Array.from(
          new Set(Object.values(ax.elective1).flatMap((arr) => arr)),
        );
        if (v.length > 0) attrGroups.push({ name: GS_NAMES.elective1, values: v });
      }
      if (ax.elective2) {
        const v = Array.from(
          new Set(Object.values(ax.elective2).flatMap((arr) => arr)),
        );
        if (v.length > 0) attrGroups.push({ name: GS_NAMES.elective2, values: v });
      }
      if (attrGroups.length === 0) {
        throw new Error(
          "Guided streams mode needs at least one of: streams, languages, elective1, elective2",
        );
      }
    }

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

    // 5. Language variants.
    //
    // Two mutually exclusive paths:
    //
    //  (a) `languageCombos.bomByCombo` provided → sibling-kit-per-combo.
    //      Write one full product per combo (kind=kit, is_variant_item=true,
    //      variant_of_product_id=template) with its own product_bundles +
    //      bundle_components from `bomByCombo[k]`. The storefront's
    //      `loadKitLanguageVariants` reads these directly. The template
    //      itself gets no product_variants rows for languages.
    //
    //  (b) `languageVariants` only → original template-variant path.
    //      Write `product_variants.size` strings matching parseBookkitLangs
    //      so the PDP resolves BOM by child-product name pattern.
    //
    // (a) is preferred for new builds (true per-combo BOM control);
    // (b) is kept for backward-compatibility with the older SAS pattern.
    const variantIds: string[] = [];
    const sizeBaseFor = (name: string) =>
      /bookkit/i.test(name) ? name.replace(/\s*$/, "") : `${name} Bookkit`;
    const siblingNameFor = (second: string, third: string) => {
      const sizeBase = sizeBaseFor(payload.name);
      const thirdAbbr = third ? LANG_TO_ABBR[third] ?? third.slice(0, 3) : null;
      return thirdAbbr
        ? `${sizeBase}${second} 2nd Lan ${thirdAbbr} 3rd Lan`
        : `${sizeBase}${second}`;
    };
    if (
      payload.languageCombos?.bomByCombo &&
      Object.keys(payload.languageCombos.bomByCombo).length > 0
    ) {
      const lc = payload.languageCombos;
      for (const combo of payload.languageVariants ?? []) {
        const second = combo.secondLang.trim();
        const third = (combo.thirdLang ?? "").trim();
        const key = `${second}||${third}`;
        const bomChildren = lc.bomByCombo?.[key] ?? [];
        if (bomChildren.length === 0) {
          // No BOM children for this combo — skip rather than write an
          // empty sibling kit that the storefront would filter out (the
          // EXISTS bundle_components check at lib/repos/products.ts:403
          // requires at least one component).
          continue;
        }
        const siblingName = siblingNameFor(second, third);
        const siblingSlug = await uniqueSlug(tx, siblingName);
        const pricePaise = lc.pricesByCombo?.[key] ?? Math.round(payload.basePrice * 100);
        const [sibling] = await tx
          .insert(products)
          .values({
            name: siblingName,
            slug: siblingSlug,
            basePrice: pricePaise,
            baseMrp: null,
            categoryId: payload.categoryId ?? null,
            status: "active",
            kind: "kit",
            isMagicBox: false,
            isVariantItem: true,
            variantOfProductId: parent.id,
          })
          .returning({ id: products.id });
        const [siblingBundle] = await tx
          .insert(productBundles)
          .values({ productId: sibling.id, bundleType: "fixed" })
          .returning({ id: productBundles.id });
        for (const child of bomChildren) {
          await insertBookkitChild(tx, siblingBundle.id, child, 0);
        }
        variantIds.push(sibling.id);
      }
    } else if (payload.languageVariants && payload.languageVariants.length > 0) {
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
        const sizeBase = sizeBaseFor(payload.name);
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
    //    `flat` writes one product_variant per cartesian combo. `stream`
    //    writes one product_variant per (streamValue × childAxisValues)
    //    combo and also tags per-stream auto-included bundle_components
    //    with selector_group_key='Stream' so the bundle engine expands
    //    them at checkout. Both modes write product_attribute_bindings
    //    so the PDP's MultiAttributePicker reads attribute_groups + each
    //    variant's attribute mapping.
    if (payload.multiAxis?.mode === "flat") {
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
    } else if (payload.multiAxis?.mode === "guidedStreams") {
      const m = payload.multiAxis;
      const streams = m.streams ?? [];
      const languages = m.languages ?? [];
      const hasStream = streams.length > 0;
      const hasLanguage = languages.length > 0;
      // Collect the full value-set per Elective axis across all combos
      // — this is what populates product_attribute_values + the picker's
      // attribute_groups JSON entry. Empty union = axis disabled.
      const e1AllLabels = m.elective1
        ? Array.from(new Set(Object.values(m.elective1).flatMap((arr) => arr)))
        : [];
      const e2AllLabels = m.elective2
        ? Array.from(new Set(Object.values(m.elective2).flatMap((arr) => arr)))
        : [];
      const hasElective1 = e1AllLabels.length > 0;
      const hasElective2 = e2AllLabels.length > 0;
      if (!hasStream && !hasLanguage && !hasElective1 && !hasElective2) {
        throw new Error(
          "Guided streams mode needs at least one of: streams, languages, elective1, elective2",
        );
      }

      // 6a. Resolve / create the four canonical attributes + their value
      //     rows. lookupOrCreateAttribute is case-insensitive, so multiple
      //     kits funnel into the same Stream / Language / Elective 1 /
      //     Elective 2 attribute IDs and aggregate cleanly under
      //     /admin/catalog/attributes.
      type ResolvedAxis = {
        attrId: string;
        attrName: string;
        valueLabels: string[];
        valueIdByLabel: Map<string, string>;
      };
      const resolved: { stream?: ResolvedAxis; language?: ResolvedAxis; e1?: ResolvedAxis; e2?: ResolvedAxis } = {};
      if (hasStream) {
        const attr = await lookupOrCreateAttribute(tx, GS_NAMES.stream, "other");
        const ids = await lookupOrCreateValues(tx, attr.id, streams);
        resolved.stream = { attrId: attr.id, attrName: attr.name, valueLabels: streams, valueIdByLabel: ids };
      }
      if (hasLanguage) {
        const attr = await lookupOrCreateAttribute(tx, GS_NAMES.language, "other");
        const ids = await lookupOrCreateValues(tx, attr.id, languages);
        resolved.language = { attrId: attr.id, attrName: attr.name, valueLabels: languages, valueIdByLabel: ids };
      }
      if (hasElective1) {
        const attr = await lookupOrCreateAttribute(tx, GS_NAMES.elective1, "other");
        const ids = await lookupOrCreateValues(tx, attr.id, e1AllLabels);
        resolved.e1 = { attrId: attr.id, attrName: attr.name, valueLabels: e1AllLabels, valueIdByLabel: ids };
      }
      if (hasElective2) {
        const attr = await lookupOrCreateAttribute(tx, GS_NAMES.elective2, "other");
        const ids = await lookupOrCreateValues(tx, attr.id, e2AllLabels);
        resolved.e2 = { attrId: attr.id, attrName: attr.name, valueLabels: e2AllLabels, valueIdByLabel: ids };
      }

      // 6b. Bindings — order matters because it drives the PDP picker
      //     order (Stream first, then Language, then Elective 1 / 2).
      const orderedBindings: { attrId: string }[] = [];
      if (resolved.stream) orderedBindings.push({ attrId: resolved.stream.attrId });
      if (resolved.language) orderedBindings.push({ attrId: resolved.language.attrId });
      if (resolved.e1) orderedBindings.push({ attrId: resolved.e1.attrId });
      if (resolved.e2) orderedBindings.push({ attrId: resolved.e2.attrId });
      await tx
        .insert(productAttributeBindings)
        .values(
          orderedBindings.map((b, idx) => ({
            productId: parent.id,
            attributeId: b.attrId,
            sortOrder: idx,
            isRequired: true,
          })),
        )
        .onConflictDoNothing();

      // 6c. Per-stream mandate items.
      //
      // The existing standalone-kit PDP renders the BOM tree of the
      // PARENT kit whenever any bundle_components exist on it, and
      // skips the MultiAttributePicker — so tagging components on the
      // parent product with selector_group_key='Stream' breaks the
      // picker (incident 2026-05-29, YIPS kit).
      //
      // The way SAS Suchitra Book Set Grade 12 works around this: each
      // axis VALUE is itself a sub_bundle product whose name matches
      // the value (e.g. "SAS Suchitra Grade 12 Mandate"), and the
      // /api/shop/variant-contents endpoint resolves each picked value
      // to that product by name lookup, then loads its BOM tree.
      //
      // We replicate that pattern here: for each Stream label with
      // mandate items, create a stub sub_bundle product named
      // `<KitName> <StreamLabel>` (the templatePrefix the PDP endpoint
      // tries) + its product_bundles row + bundle_components for each
      // mandate item. The parent kit stays free of bundle_components
      // (preserving the picker), and the storefront's "What's in your
      // kit" section automatically populates the matching axis chip
      // with these books — without any storefront code change.
      if (resolved.stream && m.mandatesPerStream) {
        const kitNameTrim = payload.name
          .replace(/\s+(book ?kit|book ?set|bookkit|bookset|kit|set)\s*$/i, "")
          .trim();
        for (const [streamLabel, mandateItems] of Object.entries(m.mandatesPerStream)) {
          if (mandateItems.length === 0) continue;
          if (!resolved.stream.valueIdByLabel.has(streamLabel)) {
            throw new Error(`mandatesPerStream key "${streamLabel}" is not in streams[]`);
          }
          // Name the stub `<KitName> <StreamLabel>` — that's the second
          // candidate the variant-contents endpoint tries (it tries the
          // raw axis value first, which we don't want to match because
          // "Science" is too generic). Idempotent against re-runs via
          // uniqueSlug + per-name conflict resolution.
          const stubName = `${kitNameTrim} ${streamLabel}`.trim();
          const stubSlug = await uniqueSlug(tx, stubName);
          const [stub] = await tx
            .insert(products)
            .values({
              name: stubName,
              slug: stubSlug,
              basePrice: 0,
              baseMrp: null,
              categoryId: payload.categoryId ?? null,
              status: "active",
              kind: "sub_bundle",
              isMagicBox: false,
            })
            .returning({ id: products.id });
          const [stubBundle] = await tx
            .insert(productBundles)
            .values({ productId: stub.id, bundleType: "fixed" })
            .returning({ id: productBundles.id });
          for (const child of mandateItems) {
            await insertBookkitChild(tx, stubBundle.id, child, 0);
          }
        }
      }

      // 6c+. Resolve the default selling price list id once so per-combo
      //      overrides can be written inside the variant loop. We only
      //      fetch it when at least one override is present — keeps the
      //      common no-override case zero-cost.
      const hasAnyPriceOverride =
        !!m.pricesByCombo && Object.keys(m.pricesByCombo).length > 0;
      let defaultPriceListId: string | null = null;
      if (hasAnyPriceOverride) {
        const [pl] = await tx
          .select({ id: priceLists.id })
          .from(priceLists)
          .where(eq(priceLists.isDefault, true))
          .limit(1);
        if (!pl) {
          throw new Error(
            "No default price list found — cannot write per-combo price overrides.",
          );
        }
        defaultPriceListId = pl.id;
      }

      // 6d. Per-combo variant generation. When an axis is disabled we
      //     iterate over a single empty-label sentinel; we skip
      //     writing its product_variant_attributes row entirely so
      //     disabled axes don't pollute the matrix.
      const streamIter = hasStream ? streams : [""];
      const langIter = hasLanguage ? languages : [""];
      const skuBase = slug.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

      for (const s of streamIter) {
        for (const l of langIter) {
          const comboKey = `${s}||${l}`;
          // When an Elective axis is enabled overall but has no entries
          // for THIS particular combo, treat the combo as unavailable —
          // skip variant generation entirely. This is how a "Science
          // doesn't ship in Hindi yet" gap is modelled.
          const e1List = hasElective1 ? (m.elective1?.[comboKey] ?? []) : [""];
          const e2List = hasElective2 ? (m.elective2?.[comboKey] ?? []) : [""];
          if (hasElective1 && e1List.length === 0) continue;
          if (hasElective2 && e2List.length === 0) continue;

          for (const e1 of e1List) {
            for (const e2 of e2List) {
              const labels: string[] = [];
              if (hasStream) labels.push(s);
              if (hasLanguage) labels.push(l);
              if (hasElective1) labels.push(e1);
              if (hasElective2) labels.push(e2);
              const sizeLabel = labels.join(" · ");
              const sku =
                skuBase +
                "-" +
                labels
                  .map((x) => x.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6))
                  .filter((x) => x.length > 0)
                  .join("-");

              const [row] = await tx
                .insert(productVariants)
                .values({
                  productId: parent.id,
                  size: sizeLabel,
                  sku,
                  stockQty: 0,
                  isActive: true,
                })
                .returning({ id: productVariants.id });
              variantIds.push(row.id);

              const vaRows: { variantId: string; attributeId: string; valueId: string }[] = [];
              if (hasStream && resolved.stream) {
                vaRows.push({
                  variantId: row.id,
                  attributeId: resolved.stream.attrId,
                  valueId: resolved.stream.valueIdByLabel.get(s)!,
                });
              }
              if (hasLanguage && resolved.language) {
                vaRows.push({
                  variantId: row.id,
                  attributeId: resolved.language.attrId,
                  valueId: resolved.language.valueIdByLabel.get(l)!,
                });
              }
              if (hasElective1 && resolved.e1) {
                vaRows.push({
                  variantId: row.id,
                  attributeId: resolved.e1.attrId,
                  valueId: resolved.e1.valueIdByLabel.get(e1)!,
                });
              }
              if (hasElective2 && resolved.e2) {
                vaRows.push({
                  variantId: row.id,
                  attributeId: resolved.e2.attrId,
                  valueId: resolved.e2.valueIdByLabel.get(e2)!,
                });
              }
              if (vaRows.length > 0) {
                await tx.insert(productVariantAttributes).values(vaRows);
              }

              if (hasAnyPriceOverride && defaultPriceListId) {
                const priceComboKey = `${s}||${l}||${e1}||${e2}`;
                const override = m.pricesByCombo?.[priceComboKey];
                if (typeof override === "number" && override >= 0) {
                  await tx.insert(itemPrices).values({
                    variantId: row.id,
                    priceListId: defaultPriceListId,
                    schoolId: null,
                    price: override,
                  });
                }
              }
            }
          }
        }
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

