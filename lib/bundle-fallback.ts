import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { loadBundleTree, loadVariantBundleTree, type BundleNode } from "@/lib/repos/products";

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
