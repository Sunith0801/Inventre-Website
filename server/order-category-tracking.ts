import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getRootCategoryFor } from "@/server/repos/categories";

export type CategoryItemTracking = {
  itemId: string;
  rootCategoryId: string | null;
  rootCategoryName: string;
  qty: number;
  deliveredQty: number;
  pickedQty: number;
  returnedQty: number;
};

export type CategoryGroupStatus =
  | "delivered"
  | "out for delivery"
  | "in transit"
  | "returned"
  | "pending";

export type CategoryGroup = {
  rootCategoryId: string | null;
  rootCategoryName: string;
  totalQty: number;
  deliveredQty: number;
  pickedQty: number;
  returnedQty: number;
  status: CategoryGroupStatus;
  items: Array<{
    id: string;
    name: string;
    qty: number;
    deliveredQty: number;
    pickedQty: number;
    returnedQty: number;
    // ERP item_code (== variant sku) for this line, used to resolve a
    // per-item delivery status against erp.outward_shipments.item_code.
    itemCode: string | null;
    // Per-item badge status. Defaults to the category status; the ERP
    // detail loader overrides it with the line's OWN shipment status when
    // the order is tracked at the line level (see erp-customer-orders.ts).
    status: CategoryGroupStatus;
  }>;
};

const OTHER_LABEL = "Other";

/**
 * Build Map<orderItemId, categoryId> for the given order id by walking
 * order_items → product_variants → products. Local rows only — used by
 * both the local detail loader and the ERP detail loader (the latter
 * falls back to the ERP-mirror line if no local row exists).
 */
export async function categoryIdByOrderItem(
  orderId: string
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!orderId) return out;
  const r: any = await db.execute(sql`
    SELECT oi.id::text         AS item_id,
           p.category_id::text AS category_id
      FROM order_items oi
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN products p          ON p.id  = pv.product_id
     WHERE oi.order_id = ${orderId}
  `);
  const rows = (r?.rows ?? r ?? []) as Array<{
    item_id: string;
    category_id: string | null;
  }>;
  for (const row of rows) out.set(row.item_id, row.category_id ?? null);
  return out;
}

/**
 * Same shape as categoryIdByOrderItem but keyed by the ERP sales_order_items
 * SKU (item_code). Used to fall back to ERP-mirror-only orders that
 * never landed in local order_items. Maps SKU → category_id by going
 * product_variants.sku → product.category_id.
 */
export async function categoryIdBySku(
  skus: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (skus.length === 0) return out;
  const r: any = await db.execute(sql`
    SELECT pv.sku, p.category_id::text AS category_id
      FROM product_variants pv
      LEFT JOIN products p ON p.id = pv.product_id
     WHERE pv.sku IN (${sql.join(
       skus.map((s) => sql`${s}`),
       sql`, `
     )})
  `);
  const rows = (r?.rows ?? r ?? []) as Array<{
    sku: string;
    category_id: string | null;
  }>;
  for (const row of rows) out.set(row.sku, row.category_id ?? null);
  return out;
}

/**
 * Map<item_code, {delivered, picked, returned, erpCategory}> from the
 * ERP mirror. Empty map when nothing has been polled yet — UI shows
 * "pending".
 *
 * `erpCategory` is the raw ERP `category` string ("bookkit" / "uniform"
 * / etc.) — it's the only join key we have to per-category shipment
 * state on `erp.outward_shipments.item_category`.
 */
export async function dispatchQtysByItemCode(
  orderErpName: string
): Promise<
  Map<
    string,
    {
      deliveredQty: number;
      pickedQty: number;
      returnedQty: number;
      erpCategory: string | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      deliveredQty: number;
      pickedQty: number;
      returnedQty: number;
      erpCategory: string | null;
    }
  >();
  if (!orderErpName) return out;
  const r: any = await db.execute(sql`
    SELECT item_code,
           COALESCE(delivered_qty,0)::float8 AS delivered_qty,
           COALESCE(picked_qty,0)::float8    AS picked_qty,
           COALESCE(returned_qty,0)::float8  AS returned_qty,
           category
      FROM erp.sales_order_items
     WHERE order_erp_name = ${orderErpName}
  `);
  const rows = (r?.rows ?? r ?? []) as Array<{
    item_code: string | null;
    delivered_qty: number;
    picked_qty: number;
    returned_qty: number;
    category: string | null;
  }>;
  for (const row of rows) {
    if (!row.item_code) continue;
    // Multiple lines can share an item_code on bundle expansions; sum.
    const cur = out.get(row.item_code) ?? {
      deliveredQty: 0,
      pickedQty: 0,
      returnedQty: 0,
      erpCategory: row.category ?? null,
    };
    cur.deliveredQty += row.delivered_qty;
    cur.pickedQty += row.picked_qty;
    cur.returnedQty += row.returned_qty;
    if (!cur.erpCategory && row.category) cur.erpCategory = row.category;
    out.set(row.item_code, cur);
  }
  return out;
}

/**
 * ERP sales_order_items rows for `orderErpName`, shaped for category
 * grouping. Audit expands Magic Box / bundle parents into per-component
 * lines (each tagged with its own `category`), so this is the right
 * source for the per-category breakdown — the local `order_items` only
 * has the bundle parent SKU, which audit never gives a category to.
 *
 * Returns an empty array when audit hasn't mirrored items yet (the
 * caller falls back to local items).
 */
export async function erpItemsForCategoryGrouping(
  orderErpName: string
): Promise<
  Array<{
    id: string;
    name: string;
    qty: number;
    categoryId: string | null;
    deliveredQty: number;
    pickedQty: number;
    returnedQty: number;
    erpCategory: string | null;
    itemCode: string | null;
  }>
> {
  if (!orderErpName) return [];
  const r: any = await db.execute(sql`
    SELECT id::text                              AS id,
           COALESCE(item_name, item_code, 'Item') AS item_name,
           COALESCE(qty, 0)::float8              AS qty,
           COALESCE(delivered_qty, 0)::float8    AS delivered_qty,
           COALESCE(picked_qty, 0)::float8       AS picked_qty,
           COALESCE(returned_qty, 0)::float8     AS returned_qty,
           category,
           item_code
      FROM erp.sales_order_items
     WHERE order_erp_name = ${orderErpName}
     ORDER BY id
  `);
  const rows = (r?.rows ?? r ?? []) as Array<{
    id: string;
    item_name: string;
    qty: number;
    delivered_qty: number;
    picked_qty: number;
    returned_qty: number;
    category: string | null;
    item_code: string | null;
  }>;
  return rows.map((row) => ({
    id: `erp:${row.id}`,
    name: row.item_name,
    qty: row.qty,
    categoryId: null,
    deliveredQty: row.delivered_qty,
    pickedQty: row.picked_qty,
    returnedQty: row.returned_qty,
    erpCategory: row.category,
    itemCode: row.item_code,
  }));
}

function statusOf(
  totalQty: number,
  deliveredQty: number,
  pickedQty: number,
  returnedQty: number
): CategoryGroupStatus {
  if (totalQty > 0 && deliveredQty >= totalQty) return "delivered";
  if (returnedQty > 0 && returnedQty >= totalQty) return "returned";
  if (pickedQty > 0 || deliveredQty > 0) return "in transit";
  return "pending";
}

export type FallbackState = "none" | "in_transit" | "delivered";

/**
 * Audit's per-category status text → our 4-state UI enum.
 * Audit uses strings like "In Transit", "Dispatched", "Delivered",
 * "Out for Delivery", "Pending", "Partial Dispatch", "Not Yet Delivered",
 * "Returned".
 *
 * Order matters: "Out for Delivery" contains the substring "deliver" but
 * is NOT a terminal state — the parcel is en-route. Customers want to see
 * it called out distinctly ("out for delivery" is a meaningful, exciting
 * step between shipped and delivered), so it gets its own enum value.
 * Match it (and the "not yet" variant) BEFORE the generic "deliver" check
 * so it doesn't flip the card to a green "delivered" tick prematurely.
 */
function mapAuditStatus(raw: string | null | undefined): CategoryGroupStatus {
  const s = (raw ?? "").toLowerCase().trim();
  if (!s) return "pending";
  if (s.includes("return")) return "returned";
  if (s.includes("out for delivery") || s.includes("ofd")) return "out for delivery";
  if (s.includes("not") && s.includes("deliver")) return "pending";
  if (s.includes("deliver")) return "delivered";
  if (
    s.includes("transit") ||
    s.includes("dispatch") ||
    s.includes("shipped") ||
    s.includes("packed") ||
    s.includes("partial")
  )
    return "in transit";
  return "pending";
}

function titleCaseCategory(key: string): string {
  // Audit gives lowercase tokens ("bookkit", "uniform"); render them
  // capitalised on the customer card.
  if (!key) return "Other";
  return key
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Build category cards directly from audit's
 * `derived_delivery_by_category` map on the order header. This is the
 * source of truth for storefront tracking — we mirror what audit says.
 *
 * Items are placed into a card by their ERP `category` (mirrored on
 * erp.sales_order_items). Orphan items (no category mirrored) are
 * matched into a card if the category key appears as a substring of
 * the item name; otherwise they go to "Other".
 */
export function groupItemsByAuditCategory(
  items: Array<{
    id: string;
    name: string;
    qty: number;
    erpCategory?: string | null;
    itemCode?: string | null;
  }>,
  derivedByCategory: Record<string, string> | null | undefined,
  categoriesPresent: string[] | null | undefined
): CategoryGroup[] {
  const byCat = derivedByCategory ?? {};
  // `derived_delivery_categories_present` is the authoritative list of
  // which categories actually appear in this order. `by_category` also
  // includes entries for categories the customer didn't buy (audit
  // emits a full ledger), so we filter to `present` when provided.
  const present = (categoriesPresent ?? [])
    .map((s) => (s ?? "").toString().toLowerCase().trim())
    .filter(Boolean);
  const allowedKeys = present.length
    ? present
    : Object.keys(byCat).map((k) => k.toLowerCase());
  if (allowedKeys.length === 0) return [];

  const groups = new Map<string, CategoryGroup>();
  for (const k of allowedKeys) {
    if (groups.has(k)) continue;
    const statusText = byCat[k] ?? byCat[Object.keys(byCat).find((kk) => kk.toLowerCase() === k) ?? ""];
    groups.set(k, {
      rootCategoryId: null,
      rootCategoryName: titleCaseCategory(k),
      totalQty: 0,
      deliveredQty: 0,
      pickedQty: 0,
      returnedQty: 0,
      status: mapAuditStatus(statusText),
      items: [],
    });
  }
  const keys = [...groups.keys()];
  const otherGroup: CategoryGroup = {
    rootCategoryId: null,
    rootCategoryName: OTHER_LABEL,
    totalQty: 0,
    deliveredQty: 0,
    pickedQty: 0,
    returnedQty: 0,
    status: "pending",
    items: [],
  };

  for (const it of items) {
    const erpCat = (it.erpCategory ?? "").toLowerCase().trim();
    let targets: CategoryGroup[] = [];
    const direct = erpCat ? groups.get(erpCat) : undefined;
    if (direct) {
      targets = [direct];
    } else if (keys.length === 1) {
      // Only one category present → every line must belong to it.
      const only = groups.get(keys[0]);
      if (only) targets = [only];
    } else {
      // Multiple present categories. Try a substring match on the item
      // name first ("…uniform shirt…" → uniform).
      const lcName = it.name.toLowerCase();
      const matchKey = keys.find((k) => k && lcName.includes(k));
      if (matchKey) {
        const g = groups.get(matchKey);
        if (g) targets = [g];
      } else if (erpCat && !groups.has(erpCat)) {
        // Container / bundle PARENT line: its own `category` is a wrapper
        // ("magic_box", "kit", …) that is NOT one of the order's delivery
        // categories. Audit tags the Magic Box parent this way and never
        // expands it into per-component lines, so this single line spans
        // EVERY present category (a Magic Box ships as bookkit + uniform
        // parcels). Fan it into all present groups instead of a synthetic
        // "Other" — otherwise the entire order collapses into one
        // "Other / pending" card even after every parcel is delivered
        // (~2,938 magic-box orders, ~1,994 of them already delivered, were
        // showing a pending stepper under a "Delivered" header badge).
        targets = keys
          .map((k) => groups.get(k))
          .filter((g): g is CategoryGroup => !!g);
      }
    }
    // Genuine orphan (no category, no name match, not a container) → Other.
    if (targets.length === 0) targets = [otherGroup];
    for (const target of targets) {
      const isMoving =
        target.status === "in transit" || target.status === "out for delivery";
      target.totalQty += it.qty;
      if (target.status === "delivered") target.deliveredQty += it.qty;
      else if (isMoving) target.pickedQty += it.qty;
      else if (target.status === "returned") target.returnedQty += it.qty;
      target.items.push({
        id: it.id,
        name: it.name,
        qty: it.qty,
        deliveredQty: target.status === "delivered" ? it.qty : 0,
        pickedQty: isMoving ? it.qty : 0,
        returnedQty: target.status === "returned" ? it.qty : 0,
        itemCode: it.itemCode ?? null,
        status: target.status,
      });
    }
  }

  // Hide cards with zero items — the customer should only see
  // categories they actually ordered.
  const out = [...groups.values()].filter((g) => g.items.length > 0);
  if (otherGroup.items.length > 0) out.push(otherGroup);
  return out;
}

/**
 * Group items by root category and roll up dispatch counts. Items with
 * no resolvable category fall into a single synthetic "Other" group.
 *
 * `fallback` covers orders where ERP records dispatch at the parcel /
 * shipment level only — `erp.sales_order_items.delivered_qty` etc. are
 * still zero, but the order has a dispatched shipment. We treat every
 * line whose counters are all zero as matching the *per-ERP-category*
 * shipping state, so a bookkit shipment doesn't make the unshipped
 * uniform lines also read as "in transit".
 *
 * `fallback` accepts either:
 *   - a global enum (legacy local-orders path with no per-category data)
 *   - a Map<erpCategory(lowercased), FallbackState> built from the
 *     order's shipments. Items whose `erpCategory` isn't in the map
 *     stay "pending".
 */
export async function groupItemsByRootCategory(
  items: Array<{
    id: string;
    name: string;
    qty: number;
    categoryId: string | null;
    deliveredQty: number;
    pickedQty: number;
    returnedQty: number;
    erpCategory?: string | null;
    itemCode?: string | null;
  }>,
  fallback: FallbackState | Map<string, FallbackState> = "none"
): Promise<CategoryGroup[]> {
  const fallbackFor = (erpCategory: string | null | undefined): FallbackState => {
    if (fallback instanceof Map) {
      if (!erpCategory) return "none";
      return fallback.get(erpCategory.toLowerCase()) ?? "none";
    }
    return fallback;
  };
  const groups = new Map<string, CategoryGroup>();
  for (const raw of items) {
    const noLineData =
      raw.deliveredQty === 0 && raw.pickedQty === 0 && raw.returnedQty === 0;
    let deliveredQty = raw.deliveredQty;
    let pickedQty = raw.pickedQty;
    if (noLineData) {
      const f = fallbackFor(raw.erpCategory);
      if (f === "delivered") deliveredQty = raw.qty;
      else if (f === "in_transit") pickedQty = raw.qty;
    }
    const it = { ...raw, deliveredQty, pickedQty };
    const root = await getRootCategoryFor(it.categoryId);
    const key = root?.id ?? "__other__";
    const name = root?.name ?? OTHER_LABEL;
    const g =
      groups.get(key) ??
      ({
        rootCategoryId: root?.id ?? null,
        rootCategoryName: name,
        totalQty: 0,
        deliveredQty: 0,
        pickedQty: 0,
        returnedQty: 0,
        status: "pending" as CategoryGroupStatus,
        items: [],
      } satisfies CategoryGroup);
    g.totalQty += it.qty;
    g.deliveredQty += it.deliveredQty;
    g.pickedQty += it.pickedQty;
    g.returnedQty += it.returnedQty;
    g.items.push({
      id: it.id,
      name: it.name,
      qty: it.qty,
      deliveredQty: it.deliveredQty,
      pickedQty: it.pickedQty,
      returnedQty: it.returnedQty,
      itemCode: it.itemCode ?? null,
      status: "pending",
    });
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    g.status = statusOf(g.totalQty, g.deliveredQty, g.pickedQty, g.returnedQty);
    // Default each item's badge to the category status; the ERP detail
    // loader overrides with the per-line shipment status where available.
    for (const it of g.items) it.status = g.status;
  }
  // Stable order: by name, with "Other" pinned last.
  return [...groups.values()].sort((a, b) => {
    if (a.rootCategoryName === OTHER_LABEL) return 1;
    if (b.rootCategoryName === OTHER_LABEL) return -1;
    return a.rootCategoryName.localeCompare(b.rootCategoryName);
  });
}
