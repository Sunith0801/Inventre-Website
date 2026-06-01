import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getRootCategoryFor } from "@/lib/repos/categories";

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
 * "Pending", "Partial Dispatch", "Not Yet Delivered", "Returned".
 */
function mapAuditStatus(raw: string | null | undefined): CategoryGroupStatus {
  const s = (raw ?? "").toLowerCase().trim();
  if (!s) return "pending";
  if (s.includes("deliver") && !s.includes("not")) return "delivered";
  if (s.includes("return")) return "returned";
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
    let target = erpCat ? groups.get(erpCat) : undefined;
    if (!target) {
      // Orphan line (no `category` mirrored on erp.sales_order_items
      // — usually a pre-migration row). If only one category is
      // present on this order, every orphan must belong to it. With
      // multiple present categories, try a substring match on the
      // item name; otherwise fall through to "Other".
      if (keys.length === 1) {
        target = groups.get(keys[0]);
      } else {
        const lcName = it.name.toLowerCase();
        const matchKey = keys.find((k) => k && lcName.includes(k));
        target = matchKey ? groups.get(matchKey) : undefined;
      }
    }
    if (!target) target = otherGroup;
    target.totalQty += it.qty;
    if (target.status === "delivered") target.deliveredQty += it.qty;
    else if (target.status === "in transit") target.pickedQty += it.qty;
    else if (target.status === "returned") target.returnedQty += it.qty;
    target.items.push({
      id: it.id,
      name: it.name,
      qty: it.qty,
      deliveredQty: target.status === "delivered" ? it.qty : 0,
      pickedQty: target.status === "in transit" ? it.qty : 0,
      returnedQty: target.status === "returned" ? it.qty : 0,
    });
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
    });
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    g.status = statusOf(g.totalQty, g.deliveredQty, g.pickedQty, g.returnedQty);
  }
  // Stable order: by name, with "Other" pinned last.
  return [...groups.values()].sort((a, b) => {
    if (a.rootCategoryName === OTHER_LABEL) return 1;
    if (b.rootCategoryName === OTHER_LABEL) return -1;
    return a.rootCategoryName.localeCompare(b.rootCategoryName);
  });
}
