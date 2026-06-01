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
     WHERE pv.sku = ANY(${skus})
  `);
  const rows = (r?.rows ?? r ?? []) as Array<{
    sku: string;
    category_id: string | null;
  }>;
  for (const row of rows) out.set(row.sku, row.category_id ?? null);
  return out;
}

/**
 * Map<item_code, {delivered, picked, returned}> from the ERP mirror.
 * Empty map when nothing has been polled yet — UI shows "pending".
 */
export async function dispatchQtysByItemCode(
  orderErpName: string
): Promise<
  Map<string, { deliveredQty: number; pickedQty: number; returnedQty: number }>
> {
  const out = new Map<
    string,
    { deliveredQty: number; pickedQty: number; returnedQty: number }
  >();
  if (!orderErpName) return out;
  const r: any = await db.execute(sql`
    SELECT item_code,
           COALESCE(delivered_qty,0)::float8 AS delivered_qty,
           COALESCE(picked_qty,0)::float8    AS picked_qty,
           COALESCE(returned_qty,0)::float8  AS returned_qty
      FROM erp.sales_order_items
     WHERE order_erp_name = ${orderErpName}
  `);
  const rows = (r?.rows ?? r ?? []) as Array<{
    item_code: string | null;
    delivered_qty: number;
    picked_qty: number;
    returned_qty: number;
  }>;
  for (const row of rows) {
    if (!row.item_code) continue;
    // Multiple lines can share an item_code on bundle expansions; sum.
    const cur = out.get(row.item_code) ?? {
      deliveredQty: 0,
      pickedQty: 0,
      returnedQty: 0,
    };
    cur.deliveredQty += row.delivered_qty;
    cur.pickedQty += row.picked_qty;
    cur.returnedQty += row.returned_qty;
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

/**
 * Group items by root category and roll up dispatch counts. Items with
 * no resolvable category fall into a single synthetic "Other" group.
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
  }>
): Promise<CategoryGroup[]> {
  const groups = new Map<string, CategoryGroup>();
  for (const it of items) {
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
