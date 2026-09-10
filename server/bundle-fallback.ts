import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { loadBundleTree, loadVariantBundleTree, type BundleNode } from "@/server/repos/products";

/**
 * Magic Box / kit composition FALLBACK.
 *
 * ~66% of magic-box order_items never captured the parent's per-component
 * picks into `order_items.bundle_selections` (different checkout paths /
 * admin-created / sum-priced boxes). Without that, the exchange & missing
 * forms can only offer the WHOLE box — the parent can't say "this item is
 * missing" / "this item needs exchange".
 *
 * The box's DEFINED composition is still fully recoverable from the bundle
 * tables: order_item → product_variants.product_id → product_bundles →
 * bundle_components. We surface that as synthetic component descriptors so
 * the existing per-component picker works. What we CAN'T recover is the
 * exact size/colour the parent received (bundle_components carries only
 * product_id, no variant) — the exchange form asks the parent for their
 * current size in that case.
 */
export type FallbackComponent = {
  orderItemId: string;
  /** Stable index within the box (for unitKey). */
  componentIndex: number;
  name: string;
  qty: number;
  productId: string;
  /** products.kind of the component (drives reason options + category chip). */
  kind: string | null;
};

/**
 * For the given order items, return Map<orderItemId, FallbackComponent[]>
 * built from the bundle definition. Only call this for items whose
 * `bundle_selections` is empty — items WITH stored selections should use
 * those verbatim. Items with no bundle definition are simply absent from
 * the map.
 */
export async function fallbackBundleComponents(
  orderItemIds: string[]
): Promise<Map<string, FallbackComponent[]>> {
  const out = new Map<string, FallbackComponent[]>();
  if (orderItemIds.length === 0) return out;
  const r: any = await db.execute(sql`
    SELECT oi.id::text          AS order_item_id,
           bc.product_id::text  AS product_id,
           COALESCE(bc.qty, 1)  AS qty,
           p.name               AS name,
           p.kind::text         AS kind
      FROM order_items oi
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN product_bundles  pb ON pb.product_id = pv.product_id
      JOIN bundle_components bc ON bc.bundle_id = pb.id
      JOIN products p ON p.id = bc.product_id
     WHERE oi.id IN (${sql.join(
       orderItemIds.map((id) => sql`${id}`),
       sql`, `
     )})
       AND bc.is_visible = true
     ORDER BY oi.id, p.name, bc.id
  `);
  const rows = (r?.rows ?? r ?? []) as Array<{
    order_item_id: string;
    product_id: string;
    qty: number;
    name: string | null;
    kind: string | null;
  }>;
  for (const row of rows) {
    const list = out.get(row.order_item_id) ?? [];
    list.push({
      orderItemId: row.order_item_id,
      componentIndex: list.length,
      name: row.name ?? "Item",
      qty: row.qty ?? 1,
      productId: row.product_id,
      kind: row.kind,
    });
    out.set(row.order_item_id, list);
  }
  return out;
}

// ── Bookkit CATEGORY tree (3-level: bookkit → category → item) ──────────
//
// A bookkit is a bundle whose direct children are `sub_bundle` CATEGORY
// products (e.g. "SMS Grade 9 Hindi", "SMS Grade 9 Notebook") — each of
// which is itself a bundle of the actual leaf books. The flat helpers above
// (and `order_items.bundle_selections`) collapse this to one level, so the
// customer could only exchange "the whole box". To let a parent drill in by
// category and pick individual books, we re-derive the full nested tree from
// the live catalog via `loadVariantBundleTree` (the SAME resolver the
// storefront "What's in your kit" accordion uses), keyed off the ordered
// bookkit variant + the order's school.
//
// "Just capture the book" scope: we surface each leaf's name + productId +
// category. We deliberately do NOT try to recover the exact ordered
// edition/size (bookkits rarely store it) — customer-care resolves the
// specific copy from the book name + category.

export type BookkitLeaf = {
  /** Stable index across the WHOLE bookkit (drives the exchange unitKey). */
  componentIndex: number;
  name: string;
  qty: number;
  productId: string;
  /** products.kind of the leaf (usually 'book'; drives reason options). */
  kind: string | null;
  categoryKey: string;   // the category sub_bundle's productId
  categoryName: string;  // e.g. "SMS Grade 9 Hindi"
};

export type BookkitCategory = {
  categoryKey: string;
  categoryName: string;
  items: BookkitLeaf[];
};

/**
 * Coarse display category for a Magic Box component, derived from
 * `products.kind`.
 *
 * The exchange/missing picker groups components into collapsible sections
 * keyed on `categoryKey`. Those keys come from the resolved BOM tree
 * (`loadBookkitCategoryTree`) — a real sub_bundle per category — which gives
 * the fine-grained split the catalog actually models (Mandate Textbook /
 * Language / Notebook / Stationery / …).
 *
 * But a magic box only resolves that tree for its nested BOOKKIT component.
 * Its uniform pieces, and every component of a recovered-composition box
 * (~66% of boxes have empty bundle_selections), carry no category at all — so
 * `categoriesFor` in the form dropped them and the whole box rendered as one
 * flat 34-item list.
 *
 * This is the fallback: a kind-based top-level split so those components still
 * group into Uniforms / Books / Stationery & Other instead of one flat run.
 * It is deliberately COARSE — deriving "Notebooks" vs "Textbooks" from item
 * names would be brittle and school-specific. When a box's BOM resolves, the
 * richer sub_bundle categories are used and this never applies.
 */
export type KindCategory = { key: string; name: string };

export function kindCategoryFor(
  kind: string | null,
  name: string | null,
): KindCategory | null {
  const k = (kind ?? "").toLowerCase();
  const n = (name ?? "").toLowerCase();
  if (k === "uniform" || k === "accessory") return { key: "kc:uniform", name: "Uniforms" };
  if (k === "book") return { key: "kc:book", name: "Books" };
  // A nested bookkit that never expanded still belongs under Books.
  if (k === "kit" && n.includes("bookkit")) return { key: "kc:book", name: "Books" };
  if (k === "consumable" || k === "stationery") {
    return { key: "kc:stationery", name: "Stationery & Other Items" };
  }
  // Unknown kind → no category, so the caller leaves it in the ungrouped run
  // rather than inventing a misleading bucket.
  return null;
}

// ─── Sub-bundle category resolution for FLAT magic-box components ───
//
// A magic box stores its books FLAT in bundle_selections (24 individual book
// components, no nested bookkit), and `loadVariantBundleTree` only fires for
// SKUs containing "Bookkit" — a box SKU like "SAS BP GRADE 4 MAGIC BOX GIRLS"
// resolves to zero categories. So the books had no category and rendered as
// one long run.
//
// The catalog DOES describe them: they belong to `sub_bundle` products
// ("Grade 4 Mandate Textbook", "SAS Grade 4 Notebook", "SAS Suchitra Other",
// "SAS BP Grade 4 Stationery"). The difficulty is that a book product is
// shared across schools and grades — "CM 50 Pages Plain Drawing Book" sits in
// the Grade 3/4/5/6/7/8 Notebook bundles of several schools — so an unscoped
// join fans out badly. Everything below is about picking the RIGHT one.

/** Words that describe the KIND of a sub-bundle, not which school it's for. */
const SUBBUNDLE_STOPWORDS = new Set([
  "grade", "textbook", "textbooks", "notebook", "notebooks", "stationery",
  "other", "others", "mandate", "language", "book", "books", "bundle", "kit",
  "bookkit", "part", "set", "program", "workbook", "worksheet", "item", "items",
  // Subject / language names. These describe the category, not the school —
  // without them "SAS Grade 4 Hindi" is rejected as carrying an unknown
  // identifier and its books fall through uncategorised. A sub-bundle from
  // ANOTHER school is still excluded on its school token ("SMS Grade 4 Hindi"
  // → "sms" unknown → rejected), so this doesn't widen the scope.
  "hindi", "telugu", "english", "french", "sanskrit", "urdu", "kannada",
  "tamil", "marathi", "malayalam", "maths", "mathematics", "science",
  "social", "evs", "computer", "gk", "moral", "value", "education",
]);

const tokenize = (s: string): string[] =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);

/** Human label for a category, from its sub-bundle name: drop the school
 *  tokens and "Grade N", keep the descriptive tail. */
function prettyCategoryLabel(subBundleName: string, vocab: Set<string>): string {
  const toks = tokenize(subBundleName);
  const kept: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === "grade") { i++; continue; }          // skip "grade" + its number
    if (/^\d+$/.test(t)) continue;
    if (vocab.has(t)) continue;                     // school/campus token
    kept.push(t);
  }
  const tail = kept.join(" ").trim();
  const titled = tail.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  if (!tail) return "Other Items";
  if (/^other$/i.test(tail)) return "Other Items";
  if (/notebook$/i.test(tail)) return "Notebooks";
  if (/textbook$/i.test(tail)) return "Text Books";
  return titled;
}

export type ResolvedCategory = { key: string; name: string };

/**
 * Map each component productId → the sub-bundle category it belongs to,
 * scoped to this box's school and grade.
 *
 * Scoping rules, in order:
 *  1. A candidate naming a DIFFERENT grade than the box is rejected
 *     ("SAS Grade 3 Notebook" for a Grade 4 box).
 *  2. A candidate carrying an identifier token the box/school vocabulary
 *     doesn't know is rejected — this is what keeps "SAS KS Grade 4
 *     Stationery" (KS campus) and "SMS Grade 4 Hindi" (different school) out
 *     of a SAS BP box, while still admitting "SAS Suchitra Other" (the school
 *     is St. Andrews High School Suchitra) and the school-agnostic
 *     "Grade 4 Mandate Textbook".
 *  3. Among survivors, the most specific wins: most matched school tokens,
 *     then the shorter name.
 *
 * Anything unresolved simply gets no category and falls back to the coarse
 * `kindCategoryFor` bucket — never a guess.
 */
export async function resolveSubBundleCategories(
  productIds: string[],
  boxName: string,
  schoolName: string | null,
): Promise<Map<string, ResolvedCategory>> {
  const out = new Map<string, ResolvedCategory>();
  const ids = productIds.filter(Boolean);
  if (ids.length === 0) return out;

  const vocab = new Set<string>([
    ...tokenize(boxName),
    ...tokenize(schoolName ?? ""),
  ]);
  for (const w of SUBBUNDLE_STOPWORDS) vocab.delete(w);
  // Box-shape words carry no school meaning and must not admit a candidate.
  for (const w of ["magic", "box", "girls", "boys", "combo"]) vocab.delete(w);

  const gradeMatch = /\bgrade\s*(\d+)/i.exec(boxName);
  const boxGrade = gradeMatch ? Number(gradeMatch[1]) : null;

  const rows = await db.execute(sql`
    SELECT sb.id::text   AS sub_id,
           sb.name       AS sub_name,
           bc.product_id::text AS product_id
      FROM products sb
      JOIN product_bundles pb ON pb.product_id = sb.id
      JOIN bundle_components bc ON bc.bundle_id = pb.id
     WHERE sb.kind = 'sub_bundle'
       AND sb.status <> 'archived'
       AND bc.is_visible = true
       AND bc.product_id::text IN (${sql.join(ids.map((v) => sql`${v}`), sql`, `)})
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);

  type Cand = { subId: string; subName: string; score: number };
  const byProduct = new Map<string, Cand[]>();

  for (const r of list as Array<{ sub_id: string; sub_name: string; product_id: string }>) {
    const toks = tokenize(r.sub_name);
    let rejected = false;
    let score = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (/^\d+$/.test(t)) {
        // A bare number in a sub-bundle name is a grade; a mismatch disqualifies.
        if (boxGrade != null && Number(t) !== boxGrade) { rejected = true; break; }
        continue;
      }
      if (SUBBUNDLE_STOPWORDS.has(t)) continue;
      if (vocab.has(t)) { score++; continue; }
      rejected = true; // unknown identifier (other school / other campus)
      break;
    }
    if (rejected) continue;
    const arr = byProduct.get(r.product_id) ?? [];
    arr.push({ subId: r.sub_id, subName: r.sub_name, score });
    byProduct.set(r.product_id, arr);
  }

  for (const [productId, cands] of byProduct) {
    cands.sort(
      (a, b) => b.score - a.score || a.subName.length - b.subName.length,
    );
    const best = cands[0];
    if (!best) continue;
    out.set(productId, {
      key: `sb:${best.subId}`,
      name: prettyCategoryLabel(best.subName, vocab),
    });
  }
  return out;
}

/** Collect every leaf descendant (nodes with no children) under `node`. */
function collectLeaves(node: BundleNode): BundleNode[] {
  if (!node.children || node.children.length === 0) return [node];
  const out: BundleNode[] = [];
  for (const c of node.children) out.push(...collectLeaves(c));
  return out;
}

/** Build categories from a resolved BOM tree: each top-level node WITH
 *  children is a category (sub_bundle) whose leaves are its books; a
 *  childless top-level node lands in an "Other items" bucket. */
function buildCategories(tree: BundleNode[]): BookkitCategory[] {
  const cats: BookkitCategory[] = [];
  let idx = 0;
  for (const top of tree) {
    const isCategory = Array.isArray(top.children) && top.children.length > 0;
    const categoryKey = top.productId;
    const categoryName = isCategory ? top.name : "Other items";
    const leafNodes = isCategory ? collectLeaves(top) : [top];
    const items: BookkitLeaf[] = leafNodes.map((leaf) => ({
      componentIndex: idx++,
      name: leaf.name,
      qty: leaf.qty || 1,
      productId: leaf.productId,
      kind: leaf.bundleLevel || null, // BundleNode.bundleLevel carries products.kind
      categoryKey,
      categoryName,
    }));
    if (items.length > 0) cats.push({ categoryKey, categoryName, items });
  }
  return cats;
}

/** True when the tree has genuine category nesting (≥1 sub_bundle with its
 *  own leaf children) — as opposed to a flat box or a single-item wrapper. */
function hasRealCategory(cats: BookkitCategory[]): boolean {
  return cats.some((c) => c.categoryName !== "Other items");
}

/**
 * Resolve a kit order line's category → leaf-item tree (bookkit, book set,
 * or any nested kit).
 *
 * `variantId` = the ordered kit variant (`order_items.variant_id`).
 * `schoolId`  = the order's school (`orders.school_id`).
 *
 * Two resolution paths — a kit resolves via EITHER:
 *   1. `loadBundleTree(productId)` — the generic recursive BOM walk. Covers
 *      book sets ("… Book Set …") and any kit whose product carries real
 *      `bundle_components` pointing at `sub_bundle` categories.
 *   2. `loadVariantBundleTree(variantId)` — the name-pattern resolver used by
 *      the storefront, needed for LANGUAGE-TEMPLATE bookkits ("… Bookkit
 *      Hindi 2nd Lan …") whose parent carries no direct bundle_components.
 *
 * Returns [] when the kit has NO genuine category nesting (a flat box or a
 * single-item wrapper) so the caller falls back to the existing flat
 * behaviour — that keeps single-book "kits" and plain magic boxes unchanged.
 * componentIndex is a single running counter so `comp:${orderItemId}:${idx}`
 * stays unique across categories.
 */
export async function loadBookkitCategoryTree(
  variantId: string,
  schoolId: string | null
): Promise<BookkitCategory[]> {
  // Resolve the variant's product so we can walk the generic BOM tree.
  let productId: string | null = null;
  try {
    const r: any = await db.execute(
      sql`SELECT product_id::text AS pid FROM product_variants WHERE id = ${variantId}`
    );
    const rows = (r?.rows ?? r ?? []) as Array<{ pid: string }>;
    productId = rows[0]?.pid ?? null;
  } catch {
    productId = null;
  }

  // 1. Generic recursive BOM from the product (book sets + real-component kits).
  let cats: BookkitCategory[] = [];
  if (productId) {
    try {
      cats = buildCategories(await loadBundleTree(productId, schoolId));
    } catch {
      cats = [];
    }
  }

  // 2. Fallback: language-template bookkits (categories matched by name).
  if (!hasRealCategory(cats)) {
    try {
      const alt = buildCategories(await loadVariantBundleTree(variantId, schoolId));
      if (hasRealCategory(alt)) cats = alt;
    } catch {
      /* keep whatever we had */
    }
  }

  // Only surface the drill-down when there's real category nesting; a flat
  // box or single-item wrapper returns [] → caller uses the flat path.
  if (!hasRealCategory(cats)) return [];
  return cats;
}

/**
 * Of the given product ids, which are EMPTY containers — a `sub_bundle`
 * (bookkit category) that has no `bundle_components` under it at all.
 *
 * Why this exists (2026-07-27): a magic box's stored `bundle_selections` can
 * name a CATEGORY rather than a book — e.g. "Bundle 1 Other", kind
 * `sub_bundle`, carrying the auto-created "Standard" variant. The picker's
 * nested-expansion only fires for `kind = 'kit'`, so a `sub_bundle` fell
 * through to the flat-component branch and rendered as a selectable line
 * reading "Bundle 1 Other · Size Standard" — a container the parent can
 * neither identify nor sensibly exchange.
 *
 * The root cause is a catalog naming split: those 9 "Bundle N Other"
 * sub_bundles hold 0 components while an identically-named `book`-kind twin
 * holds the real 1–4 books (same shape as the audit /boms split). Until the
 * catalog is healed, the picker hides the empty containers rather than
 * offering a meaningless row.
 *
 * NOTE it returns only the EMPTY ones. A populated category (e.g.
 * "SAS Keesara Grade UKG Other", 5 books) is left alone — it still names a
 * real group of items, so hiding it would silently drop those books from the
 * flow.
 */
export async function emptyContainerProductIds(
  productIds: string[],
): Promise<Set<string>> {
  const empty = new Set<string>();
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return empty;
  const rows = (await db.execute(sql`
    SELECT p.id::text AS id
      FROM products p
     WHERE p.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
       AND p.kind = 'sub_bundle'
       AND NOT EXISTS (
         SELECT 1
           FROM product_bundles pb
           JOIN bundle_components bc ON bc.bundle_id = pb.id
          WHERE pb.product_id = p.id
       )
  `)) as unknown as Array<{ id: string }>;
  for (const r of rows) empty.add(r.id);
  return empty;
}

/**
 * Recover a magic box's BOOK side when `bundle_selections` stored the
 * uniforms but not the bookkit.
 *
 * Why this exists (2026-08-10, reported on SAL-ORD-2026-33270): the picker
 * treats a NON-EMPTY `bundle_selections` as the authoritative composition —
 * `fallbackBundleComponents` above only fires when the list is completely
 * empty. But a list can be PARTIAL. On this order the 11 uniform components
 * were recovered from the packing rows (`backfilledFromPacking: true`) while
 * the bookkit, which ships as one parcel with a BLANK `item_code`, matched
 * nothing and was never written back. The box's definition carries
 * "SAS Keesara Grade 7 Bookkit" (kind `kit`); the order's selections do not.
 * So the parent saw every uniform in the exchange / missing picker and not a
 * single book — with no way to report a book at all.
 *
 * Deliberately narrow. We add a defined component back ONLY when:
 *   - it is mandatory (`is_visible`, not optional, no selector group) — an
 *     optional / one-of-N pick is a genuine choice we can't reconstruct; and
 *   - it is book-side (`kit` / `sub_bundle` / `book` / `consumable`); and
 *   - the stored selections contain NO book-side component whatsoever.
 *
 * That last clause is the safety rail: it fires only for boxes whose book
 * half is entirely absent from the record (196 order lines on prod), never
 * for one where the parent's picks are partially present — there, a stored
 * list IS evidence of what was chosen (a language-template bookkit resolves
 * to a different product than the one the box names, and must not be
 * "topped up" with the generic one).
 *
 * The entry carries EVERY active variant of the component product, because a
 * bookkit is usually a LANGUAGE TEMPLATE — "SAS Keesara Grade 7 Bookkit" has
 * a "Hindi 2nd Lan" and a "Telugu 2nd Lan" variant, and the record doesn't
 * say which one this student got (125 of the 196 affected lines are this
 * shape). `loadBookkitCategoryTreeUnion` below unions their trees: on Grade 7
 * that's 26 identical books plus 3 Hindi and 3 Telugu ones, each already
 * sitting under its own language-named category, so the parent simply picks
 * from the language group they actually have.
 */
export type RecoveredSelection = {
  /** The component's sole variant, or "" when it has none or several. */
  variantId: string;
  /** Every active variant of the component product (language templates). */
  variantIds: string[];
  componentProductId: string;
  name: string;
  qty: number;
  size: string;
  attributes: never[];
  /** Marks the entry as re-derived from the catalog, not stored at checkout. */
  recoveredFromDefinition: true;
};

const BOOK_SIDE_KINDS = new Set(["kit", "sub_bundle", "book", "consumable"]);

export async function recoverMissingBookkitSelections(
  items: Array<{ id: string; variantId: string | null; bundleSelections: unknown }>,
): Promise<Map<string, RecoveredSelection[]>> {
  const out = new Map<string, RecoveredSelection[]>();
  // Only boxes that stored SOMETHING (an empty list already has its own path).
  const candidates = items.filter(
    (it) =>
      it.variantId &&
      Array.isArray(it.bundleSelections) &&
      it.bundleSelections.length > 0,
  );
  if (candidates.length === 0) return out;

  // Which stored components are book-side? Resolve each selection's product
  // via its variantId, falling back to the componentProductId legacy rows
  // carry. Any hit disqualifies the whole order item (see the safety rail).
  const storedProductIds = new Set<string>();
  for (const it of candidates)
    for (const c of it.bundleSelections as Array<Record<string, unknown>>) {
      const vid = typeof c?.variantId === "string" ? c.variantId : "";
      const pid =
        typeof c?.componentProductId === "string" ? c.componentProductId : "";
      if (/^[0-9a-f-]{36}$/i.test(vid)) storedProductIds.add(vid);
      if (/^[0-9a-f-]{36}$/i.test(pid)) storedProductIds.add(pid);
    }
  const bookSideIds = new Set<string>();
  if (storedProductIds.size > 0) {
    const rows = (await db.execute(sql`
      SELECT id::text AS id FROM (
        SELECT p.id, p.kind FROM products p
         WHERE p.id IN (${sql.join(
           [...storedProductIds].map((i) => sql`${i}::uuid`),
           sql`, `,
         )})
        UNION ALL
        SELECT pv.id, p.kind
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
         WHERE pv.id IN (${sql.join(
           [...storedProductIds].map((i) => sql`${i}::uuid`),
           sql`, `,
         )})
      ) t
      WHERE t.kind IN ('kit','sub_bundle','book','consumable')
    `)) as unknown as Array<{ id: string }>;
    for (const r of rows) bookSideIds.add(r.id);
  }

  const needsBooks = candidates.filter((it) => {
    for (const c of it.bundleSelections as Array<Record<string, unknown>>) {
      const vid = typeof c?.variantId === "string" ? c.variantId : "";
      const pid =
        typeof c?.componentProductId === "string" ? c.componentProductId : "";
      if (bookSideIds.has(vid) || bookSideIds.has(pid)) return false;
    }
    return true;
  });
  if (needsBooks.length === 0) return out;

  // The mandatory book-side components the box DEFINES, plus the component
  // product's sole variant (null when it has more than one).
  const rows = (await db.execute(sql`
    SELECT oi.id::text                AS order_item_id,
           bc.product_id::text        AS product_id,
           COALESCE(bc.qty, 1)        AS qty,
           p.name                     AS name,
           p.kind::text               AS kind,
           -- The component's ONLY variant, or NULL when it has several
           -- (a multi-size product's variant is not recoverable — see above).
           (SELECT min(pv2.id::text)
              FROM product_variants pv2
             WHERE pv2.product_id = p.id
            HAVING count(*) = 1)      AS sole_variant_id,
           -- Every active variant: a language-template bookkit's tree is
           -- unioned across these (see loadBookkitCategoryTreeUnion).
           (SELECT array_agg(pv3.id::text ORDER BY pv3.id::text)
              FROM product_variants pv3
             WHERE pv3.product_id = p.id
               AND pv3.is_active = true) AS variant_ids
      FROM order_items oi
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN product_bundles  pb ON pb.product_id = pv.product_id
      JOIN bundle_components bc ON bc.bundle_id = pb.id
      JOIN products p ON p.id = bc.product_id
     WHERE oi.id IN (${sql.join(
       needsBooks.map((it) => sql`${it.id}::uuid`),
       sql`, `,
     )})
       AND bc.is_visible = true
       AND bc.is_optional = false
       AND bc.selector_group_key IS NULL
       AND p.kind IN ('kit','sub_bundle','book','consumable')
     ORDER BY oi.id, p.name, bc.id
  `)) as unknown as Array<{
    order_item_id: string;
    product_id: string;
    qty: number;
    name: string | null;
    kind: string | null;
    sole_variant_id: string | null;
    variant_ids: string[] | null;
  }>;

  for (const r of rows) {
    if (!BOOK_SIDE_KINDS.has(r.kind ?? "")) continue;
    const list = out.get(r.order_item_id) ?? [];
    list.push({
      variantId: r.sole_variant_id ?? "",
      variantIds: r.variant_ids ?? [],
      componentProductId: r.product_id,
      name: r.name ?? "Books",
      qty: r.qty ?? 1,
      size: "",
      attributes: [],
      recoveredFromDefinition: true,
    });
    out.set(r.order_item_id, list);
  }
  return out;
}

/**
 * `loadBookkitCategoryTree` over SEVERAL variants of the same bookkit,
 * merged into one category → book tree.
 *
 * Needed only for the recovery path above: when the record doesn't say which
 * language template a student received, the parent should still be able to
 * find their book. The categories are language-named ("SAS Grade 7 Hindi" /
 * "SAS Grade 7 Telugu"), so a merged tree reads as "pick your language group"
 * rather than a jumble — and the 26 books both templates share appear once.
 *
 * Dedup key is categoryKey + book name: the same leaf resolved from two
 * variants is one book, and componentIndex is re-numbered across the whole
 * merged tree so `comp:${orderItemId}:${idx}` stays unique (the unitKey
 * contract the pickers rely on).
 */
export async function loadBookkitCategoryTreeUnion(
  variantIds: string[],
  schoolId: string | null,
): Promise<BookkitCategory[]> {
  const ids = [...new Set(variantIds.filter((v) => /^[0-9a-f-]{36}$/i.test(v)))];
  if (ids.length === 0) return [];
  const merged = new Map<string, BookkitCategory>();
  const seen = new Set<string>();
  for (const vid of ids) {
    let cats: BookkitCategory[] = [];
    try {
      cats = await loadBookkitCategoryTree(vid, schoolId);
    } catch {
      continue;
    }
    for (const cat of cats) {
      const bucket =
        merged.get(cat.categoryKey) ??
        { categoryKey: cat.categoryKey, categoryName: cat.categoryName, items: [] };
      for (const leaf of cat.items) {
        const key = `${cat.categoryKey}::${leaf.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bucket.items.push(leaf);
      }
      merged.set(cat.categoryKey, bucket);
    }
  }
  // Re-number across the merged tree so the unitKeys stay unique.
  let idx = 0;
  const out = [...merged.values()].filter((c) => c.items.length > 0);
  for (const cat of out)
    for (const leaf of cat.items) leaf.componentIndex = idx++;
  return out;
}
