import "server-only";
/**
 * Customer-facing "My Orders" backed by the ERP sales-order mirror
 * (`erp` schema). The logged-in parent is matched to ERP orders by phone:
 *
 *   parents.phone  ==(last 10 digits)==  erp.sales_orders.contact_mobile
 *
 * Order id used by the UI is the ERP docname (erp_name, e.g.
 * SAL-ORD-2026-27054). These tables are not in db/schema.ts (external
 * mirror) so we use raw SQL via db.execute().
 */
import { and, eq, inArray } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orderItems,
  orders,
  parents,
  payments,
  productAttributes,
  productAttributeValues,
  productVariantAttributes,
  students,
} from "@/db/schema";
import {
  categoryIdBySku,
  dispatchQtysByItemCode,
  groupItemsByAuditCategory,
  groupItemsByRootCategory,
  type CategoryGroup,
} from "@/lib/order-category-tracking";

/**
 * Build a Map<variantId, [{name, value}]> for the given variant ids.
 * Mirrors lib/repos/cart.ts so order-detail can render multi-axis picks
 * (Uniform Colour · Size, Bookkit 2nd Language) instead of falling back
 * to the bare concatenated SKU. Empty list for variants with no attribute
 * rows (plain size-only items).
 */
async function attrsByVariantId(
  variantIds: string[]
): Promise<Map<string, { name: string; value: string }[]>> {
  const out = new Map<string, { name: string; value: string }[]>();
  if (variantIds.length === 0) return out;
  const rows = await db
    .select({
      variantId: productVariantAttributes.variantId,
      name: productAttributes.name,
      value: productAttributeValues.value,
    })
    .from(productVariantAttributes)
    .innerJoin(productAttributes, eq(productAttributes.id, productVariantAttributes.attributeId))
    .innerJoin(productAttributeValues, eq(productAttributeValues.id, productVariantAttributes.valueId))
    .where(inArray(productVariantAttributes.variantId, variantIds));
  for (const r of rows) {
    const list = out.get(r.variantId) ?? [];
    list.push({ name: r.name, value: r.value });
    out.set(r.variantId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function rows<T>(r: unknown): T[] {
  return r as unknown as T[];
}
function inList(values: string[]): SQL {
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

// ERPNext stores item images as relative paths like "/files/Bag.png".
const ERP_IMG_BASE = (
  process.env.ERPNEXT_BASE || "https://erp.inventre.in"
).replace(/\/+$/, "");
function imgUrl(p: string | null | undefined): string {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  return ERP_IMG_BASE + encodeURI(p.startsWith("/") ? p : "/" + p);
}

/**
 * Map an ERP order to the UI's 5-stage pipeline.
 *
 * Shipments are the strongest signal of real fulfilment progress, so they
 * win over the (often-lagging) ERP order-level display status:
 *   - has shipments, ALL delivered  → delivered
 *   - has shipments, some delivered → shipped (partial)
 *   - has shipments, none delivered → shipped
 * We require ALL shipments delivered (not "any") so a single stray
 * delivered line on a multi-parcel order doesn't mark it delivered.
 * With no shipments, fall back to custom_display_status. NB: "Not Yet
 * Delivered" contains "delivered" — guard the "not".
 */
function uiStatus(
  displayStatus: string | null,
  shipN: number,
  shipDelivered: number,
  sealedPackingUnits: number,
  dispatchedPackingUnits = 0
): string {
  const d = (displayStatus ?? "").toLowerCase();
  if (d.includes("cancel")) return "cancelled";
  if (d.includes("return")) return "returned";
  if (shipN > 0) {
    if (shipDelivered >= shipN) return "delivered";
    return "shipped";
  }
  // No shipment row yet, but packing units carry truth: any
  // `dispatched` unit means the parcel has left the warehouse → shipped.
  // Otherwise any `sealed` unit means it's physically packed.
  if (dispatchedPackingUnits > 0) return "shipped";
  if (sealedPackingUnits > 0) return "packed";
  if (d.includes("partial")) return "shipped"; // "Partially Delivered" = in transit
  if (d.includes("complete") || (d.includes("delivered") && !d.includes("not")))
    return "delivered";
  if (d.includes("packed")) return "packed";
  if (
    d.includes("shipped") ||
    d.includes("shipment") ||
    d.includes("dispatch") ||
    d.includes("transit")
  )
    return "shipped";
  return "confirmed";
}

async function parentPhone10(parentId: string): Promise<string | null> {
  const [p] = await db
    .select({ phone: parents.phone })
    .from(parents)
    .where(eq(parents.id, parentId))
    .limit(1);
  if (!p?.phone) return null;
  const digits = p.phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export type ParentOrderListItem = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
  itemCount: number;
  thumbUrl: string | null;
  // For parents with multiple students, the UI shows which child this
  // order belongs to. ERPNext keeps the student's name in
  // sales_orders.customer_name; enrollment comes from erp.customers.
  studentName: string | null;
  enrollment: string | null;
};

export async function listParentOrdersFromErp(
  parentId: string
): Promise<ParentOrderListItem[]> {
  const phone = await parentPhone10(parentId);
  if (!phone) return [];

  // Source of truth = LOCAL `orders` table for this parent UNION
  // mirror rows matched by phone (covers legacy orders placed before
  // parent linking + any mismatched parent_id). Dedup by order_number.
  // Without this UNION, a just-placed order doesn't appear until the
  // drain → poll roundtrip (~3-4 min) puts it in the mirror.
  const orders = rows<{
    order_no: string;
    txn: string | null;
    display_status: string | null;
    payment_status: string | null;
    grand_total: number | null;
    item_count: number;
    ship_n: number;
    ship_delivered: number;
    sealed_pu: number;
    dispatched_pu: number;
    thumb: string | null;
    student_name: string | null;
    enrollment: string | null;
    local_status: string | null;
  }>(
    await db.execute(sql`
      WITH parent_orders AS (
        -- Dedup by order_no, preferring the local row when present
        -- (carries local_status + accurate receiverName). Mirror-only
        -- rows fill in legacy orders placed before parent linking.
        SELECT DISTINCT ON (order_no)
               order_no, txn, local_status
          FROM (
            SELECT o.order_number              AS order_no,
                   o.created_at::date::text    AS txn,
                   o.status::text              AS local_status,
                   1                           AS pri
              FROM orders o
             WHERE o.parent_id = ${parentId}
            UNION ALL
            SELECT so.erp_name                 AS order_no,
                   so.transaction_date::text   AS txn,
                   NULL                        AS local_status,
                   2                           AS pri
              FROM erp.sales_orders so
             WHERE right(regexp_replace(coalesce(so.contact_mobile,''), '\\D', '', 'g'), 10)
                     = ${phone}
          ) src
         ORDER BY order_no, pri
      )
      SELECT po.order_no,
             COALESCE(so.transaction_date::text, po.txn) AS txn,
             so.custom_display_status AS display_status,
             so.custom_payment_status AS payment_status,
             -- ERP grand_total is in rupees; local orders.total is in PAISE.
             -- Divide the local fallback so the UI gets rupees either way.
             round(COALESCE(so.grand_total, lo.total / 100.0)::numeric, 0)::int AS grand_total,
             COALESCE(NULLIF(i.cnt, 0), li.cnt, 0)::int AS item_count,
             COALESCE(sh.n, 0)::int AS ship_n,
             COALESCE(sh.delivered, 0)::int AS ship_delivered,
             COALESCE(pu.sealed, 0)::int AS sealed_pu,
             COALESCE(pu.dispatched, 0)::int AS dispatched_pu,
             thumb.image AS thumb,
             -- Identify the child this order was placed for, so a parent
             -- with multiple students sees one group per child. Source of
             -- truth = orders.student_id (set at checkout). Fall back to
             -- shipping receiverName only when the local order row is
             -- missing (mirror-only legacy orders predating parent linking);
             -- final fallback to ERP customer_name keeps the row visible
             -- but unaffiliated.
             COALESCE(s.name, lo.shipping_address->>'receiverName', so.customer_name) AS student_name,
             COALESCE(s.enrollment_number, c.custom_enrollment_number) AS enrollment,
             po.local_status
        FROM parent_orders po
        LEFT JOIN erp.sales_orders so ON so.erp_name = po.order_no
        LEFT JOIN orders lo
               ON lo.order_number = po.order_no OR lo.erp_so_name = po.order_no
        LEFT JOIN students s ON s.id = lo.student_id
        LEFT JOIN erp.customers c ON c.erp_name = so.customer
        LEFT JOIN LATERAL (
          SELECT count(*) AS cnt FROM erp.sales_order_items x
           WHERE x.order_erp_name = po.order_no
        ) i ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS cnt FROM order_items oi
           WHERE oi.order_id = lo.id
        ) li ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS n,
                 count(*) FILTER (WHERE x.status = 'delivered') AS delivered
            FROM erp.outward_shipments x WHERE x.order_erp_name = po.order_no
        ) sh ON true
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE pu.status = 'sealed')     AS sealed,
                 count(*) FILTER (WHERE pu.status = 'dispatched') AS dispatched
            FROM erp.packing_units pu WHERE pu.order_erp_name = po.order_no
        ) pu ON true
        LEFT JOIN LATERAL (
          -- Prefer the R2 URL captured at checkout (order_items.image_snapshot).
          -- Fall back to ERP items.image (relative path; resolved by imgUrl()).
          -- ERP-mirror-only orders (no local row) take the fallback only.
          SELECT COALESCE(
                   NULLIF(oi_local.image_snapshot, ''),
                   NULLIF(it.image, '')
                 ) AS image
            FROM erp.sales_order_items soi
            LEFT JOIN erp.items it ON it.erp_name = soi.item_code
            LEFT JOIN order_items oi_local
                   ON oi_local.order_id = lo.id
                  AND oi_local.name_snapshot = soi.item_name
           WHERE soi.order_erp_name = po.order_no
             AND (oi_local.image_snapshot IS NOT NULL AND oi_local.image_snapshot <> ''
                  OR (it.image IS NOT NULL AND it.image <> ''))
           ORDER BY soi.id
           LIMIT 1
        ) thumb ON true
       ORDER BY COALESCE(so.transaction_date::text, po.txn) DESC NULLS LAST,
                po.order_no DESC
    `)
  );

  return orders.map((o) => ({
    id: o.order_no,
    orderNumber: o.order_no,
    // Prefer ERP-derived status. When ERP has no signal yet (just-placed
    // order still in drain buffer), fall back to local orders.status so
    // the card shows "Confirmed" / "Packed" / "Shipped" / etc. instead
    // of defaulting to "confirmed" for paid orders mid-roundtrip.
    status:
      uiStatus(
        o.display_status,
        o.ship_n,
        o.ship_delivered,
        o.sealed_pu,
        o.dispatched_pu
      ) === "confirmed" && o.local_status
        ? o.local_status
        : uiStatus(
            o.display_status,
            o.ship_n,
            o.ship_delivered,
            o.sealed_pu,
            o.dispatched_pu
          ),
    paymentStatus:
      (o.payment_status ?? "").toUpperCase() === "SUCCESS"
        ? "paid"
        : (o.payment_status ?? "pending").toLowerCase(),
    total: o.grand_total ?? 0,
    createdAt: o.txn ? new Date(o.txn).toISOString() : new Date().toISOString(),
    itemCount: o.item_count,
    thumbUrl: imgUrl(o.thumb),
    studentName: o.student_name,
    enrollment: o.enrollment,
  }));
}

export type ParentOrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: number;
  tax: number;
  shipping: number;
  discount: number;
  total: number;
  shippingAddress: {
    receiverName: string;
    receiverPhone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  placedAt: string | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  items: {
    id: string;
    name: string;
    size: string;
    qty: number;
    unitPrice: number;
    total: number;
    imageUrl: string;
    /** Magic Box / bundle picks captured at checkout. null for plain lines.
     *  ERP-synced orders are best-effort enriched from the local
     *  `order_items` mirror by orderNumber — if the local row has been
     *  garbage-collected, this will be null on ERP rows.
     *  `attributes` is enriched at read time from product_variant_attributes
     *  so multi-axis picks (Uniform Colour × Size, bookkit 2nd Language)
     *  render their values instead of the unreadable concatenated SKU. */
    bundleSelections: {
      componentProductId: string;
      name: string;
      qty: number;
      variantId: string;
      size: string;
      attributes: { name: string; value: string }[];
    }[] | null;
  }[];
  payment: { provider: string; status: string; method: string | null } | null;
  tracking: {
    partner: string;
    trackingNumber: string | null;
    status: string;
    dispatchedAt: string | null;
    deliveredAt: string | null;
  }[];
  // Which student this order is for. Parents with multiple kids share one
  // phone-keyed login, so the UI labels each order with the child's name +
  // enrollment number to disambiguate.
  studentName: string | null;
  enrollment: string | null;
  /** Per-root-category dispatch roll-up for the "Tracking by category"
   *  section on the My Orders detail page. Empty array if the order
   *  has no items (shouldn't happen) or category resolution failed
   *  entirely. Items with no resolvable category bucket into a single
   *  synthetic "Other" group. */
  categoryGroups: CategoryGroup[];
  /** True when the ERP poll hasn't run for this order yet — the UI
   *  shows a "Tracking will appear within a few minutes" banner. */
  pollPending: boolean;
};

export async function getParentOrderDetailFromErp(
  parentId: string,
  orderNo: string
): Promise<ParentOrderDetail | null> {
  const phone = await parentPhone10(parentId);
  if (!phone) return null;

  const [o] = rows<{
    order_no: string;
    customer_name: string | null;
    contact_mobile: string | null;
    txn: string | null;
    display_status: string | null;
    payment_status: string | null;
    payment_mode: string | null;
    payment_flow: string | null;
    grand_total: number | null;
    net_total: number | null;
    tax_total: number | null;
    address_display: string | null;
    shipping_address: string | null;
    pincode: string | null;
    sealed_pu: number;
    dispatched_pu: number;
    enrollment: string | null;
    local_ship: Record<string, unknown> | null;
    derived_by_category: Record<string, string> | null;
    derived_categories_present: string[] | null;
  }>(
    await db.execute(sql`
      SELECT so.erp_name AS order_no, so.customer_name, so.contact_mobile,
             so.transaction_date::text AS txn,
             so.custom_display_status AS display_status,
             so.custom_payment_status AS payment_status,
             so.custom_payment_mode AS payment_mode,
             so.custom_payment_flow AS payment_flow,
             round(so.grand_total::numeric,0)::int AS grand_total,
             round(coalesce(so.net_total,so.grand_total)::numeric,0)::int AS net_total,
             round(coalesce(so.total_taxes_and_charges,0)::numeric,0)::int AS tax_total,
             so.address_display, so.shipping_address,
             so.custom_pin_code AS pincode,
             (SELECT count(*) FROM erp.packing_units pu
                WHERE pu.order_erp_name = so.erp_name AND pu.status = 'sealed')::int
               AS sealed_pu,
             (SELECT count(*) FROM erp.packing_units pu
                WHERE pu.order_erp_name = so.erp_name AND pu.status = 'dispatched')::int
               AS dispatched_pu,
             c.custom_enrollment_number AS enrollment,
             lo.shipping_address AS local_ship,
             so.raw->'derived_delivery_by_category' AS derived_by_category,
             -- Guard against the value being a jsonb scalar (incl. jsonb
             -- null), which COALESCE does NOT replace — only SQL NULL
             -- does. Without the type check, jsonb_array_elements_text
             -- crashes with "cannot extract elements from a scalar" (seen
             -- on SAL-ORD-2026-31886 after audit-side delivery flip).
             ARRAY(SELECT jsonb_array_elements_text(
                            CASE
                              WHEN jsonb_typeof((so.raw::jsonb)->'derived_delivery_categories_present') = 'array'
                              THEN (so.raw::jsonb)->'derived_delivery_categories_present'
                              ELSE '[]'::jsonb
                            END))
               AS derived_categories_present
      FROM erp.sales_orders so
      LEFT JOIN erp.customers c ON c.erp_name = so.customer
      LEFT JOIN orders lo ON lo.erp_so_name = so.erp_name
      WHERE so.erp_name = ${orderNo}
        AND right(regexp_replace(coalesce(so.contact_mobile,''), '\\D', '', 'g'), 10) = ${phone}
      LIMIT 1
    `)
  );
  if (!o) return null;

  const items = rows<{
    id: number;
    item_name: string | null;
    qty: number | null;
    rate: number | null;
    amount: number | null;
    image: string | null;
    bundle_selections: unknown;
    sku: string | null;
  }>(
    await db.execute(sql`
      -- Items source: prefer the LOCAL order_items (captured at checkout,
      -- the source of truth for what the customer ordered). Fall back to
      -- the ERP mirror only when local has no rows (legacy mirror-only
      -- orders that were placed before the storefront started writing
      -- local rows). Image: local image_snapshot (R2) wins; falls back
      -- to erp.items.image (now also R2 after the rehost migration).
      -- NB: local order_items stores prices in PAISE (integer);
      -- divide by 100 so the downstream Math.round produces rupees.
      -- bundle_selections only exists on local rows; ERP mirror has
      -- no concept of Magic Box picks, so we project NULL there.
      -- sku is surfaced so the category-tracking enricher can join to
      -- erp.sales_order_items.item_code (the dispatch counters).
      WITH local_items AS (
        SELECT oi.id::text AS id, oi.name_snapshot AS item_name,
               oi.qty::float8 AS qty,
               (oi.unit_price / 100.0)::float8 AS rate,
               (oi.total      / 100.0)::float8 AS amount,
               oi.image_snapshot AS image,
               oi.bundle_selections AS bundle_selections,
               pv.sku AS sku,
               row_number() OVER (ORDER BY oi.id) AS rn
          FROM order_items oi
          JOIN orders lo ON lo.id = oi.order_id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id
         WHERE lo.erp_so_name = ${orderNo}
      ),
      erp_items AS (
        SELECT soi.id::text AS id, soi.item_name,
               soi.qty::float8 AS qty,
               soi.rate::float8 AS rate,
               soi.amount::float8 AS amount,
               COALESCE(NULLIF(it.image,''), NULLIF(vt.image,'')) AS image,
               NULL::jsonb AS bundle_selections,
               soi.item_code AS sku
          FROM erp.sales_order_items soi
          LEFT JOIN erp.items it ON it.erp_name = soi.item_code
          LEFT JOIN erp.items vt ON vt.erp_name = it.variant_of
         WHERE soi.order_erp_name = ${orderNo}
         ORDER BY soi.id
      )
      SELECT id, item_name, qty, rate, amount, image, bundle_selections, sku
        FROM local_items
       WHERE (SELECT count(*) FROM local_items) > 0
      UNION ALL
      SELECT id, item_name, qty, rate, amount, image, bundle_selections, sku
        FROM erp_items
       WHERE (SELECT count(*) FROM local_items) = 0
    `)
  );

  // Shipments come from TWO sources on the new ERP:
  //   1. erp.outward_shipments — populated when the order uses ERP's
  //      outward shipment workflow (legacy path).
  //   2. erp.packing_units — populated when warehouse uses pack →
  //      seal → dispatch in /warehouse-packing (current default flow).
  // Without #2 the customer sees "shipped" status but no tracking
  // number / carrier, because the row that has them is in packing_units.
  const shipments = rows<{
    partner: string | null;
    tracking_number: string | null;
    status: string | null;
    dispatched_at: string | null;
    delivered_at: string | null;
    item_category: string | null;
  }>(
    await db.execute(sql`
      SELECT partner, tracking_number, status,
             dispatched_at::text AS dispatched_at,
             delivered_at::text  AS delivered_at,
             item_category
        FROM erp.outward_shipments
       WHERE order_erp_name = ${orderNo}
      UNION ALL
      SELECT partner, tracking_number,
             CASE
               WHEN status = 'dispatched' THEN 'shipped'
               WHEN status = 'sealed'     THEN 'packed'
               ELSE status
             END AS status,
             dispatched_at::text AS dispatched_at,
             NULL::text          AS delivered_at,
             NULL::text          AS item_category
        FROM erp.packing_units
       WHERE order_erp_name = ${orderNo}
         AND status IN ('sealed','dispatched')
      ORDER BY dispatched_at DESC NULLS LAST
    `)
  );

  const created = o.txn ? new Date(o.txn).toISOString() : new Date().toISOString();
  const addrBlob = (o.address_display || o.shipping_address || "").trim();
  // Prefer the structured jsonb captured at checkout on the local
  // orders table — ERP's /api/orders/{name} doesn't return the
  // shipping address, so the mirror columns are NULL. The local jsonb
  // has receiverName/Phone/line1/city/state/pincode straight from the
  // checkout form, which is the source of truth for parents.
  const ls = (o.local_ship ?? {}) as Record<string, string | undefined>;
  const shipDelivered = shipments.filter(
    (s) => s.status === "delivered"
  ).length;

  // Collect variantIds from every Magic Box pick so we can attach the
  // per-axis attribute breakdown alongside the legacy `size` field.
  // Without this enrichment, multi-axis components (Uniform Colour ×
  // Size, bookkit 2nd Language) would render the raw concatenated SKU.
  const erpBundleVariantIds: string[] = [];
  for (const it of items) {
    const bs = it.bundle_selections as
      | { variantId?: string }[]
      | null
      | undefined;
    if (Array.isArray(bs)) {
      for (const s of bs) if (s.variantId) erpBundleVariantIds.push(s.variantId);
    }
  }
  const erpAttrsByVariant = await attrsByVariantId(
    Array.from(new Set(erpBundleVariantIds))
  );

  // Category-wise tracking roll-up. Resolve each item's root category
  // via product_variants.sku → products.category_id, and its dispatch
  // counters via erp.sales_order_items keyed by item_code (== sku).
  const skus = Array.from(
    new Set(items.map((it) => it.sku).filter((s): s is string => !!s))
  );
  const [catBySku, qtysByCode, pollMeta] = await Promise.all([
    categoryIdBySku(skus),
    dispatchQtysByItemCode(orderNo),
    db
      .execute(sql`
        SELECT erp_last_polled_at, created_at
          FROM orders
         WHERE erp_so_name = ${orderNo}
         LIMIT 1
      `)
      .then((r: any) => (r?.rows ?? r ?? [])[0] as {
        erp_last_polled_at: string | null;
        created_at: string;
      } | undefined),
  ]);
  // Audit is the source of truth for per-category tracking. Its
  // /api/orders/{name} header gives a `derived_delivery_by_category`
  // map (e.g. {"bookkit":"In Transit","uniform":"Pending"}) which is
  // exactly what the customer's card should show. We mirror that
  // verbatim and only fall back to the older per-shipment derivation
  // when the audit field is missing (very old polled orders).
  const itemsForGrouping = items.map((it) => {
    const qtys = (it.sku && qtysByCode.get(it.sku)) || {
      deliveredQty: 0,
      pickedQty: 0,
      returnedQty: 0,
      erpCategory: null as string | null,
    };
    return {
      id: String(it.id),
      name: it.item_name ?? "Item",
      qty: it.qty ?? 0,
      categoryId: it.sku ? catBySku.get(it.sku) ?? null : null,
      deliveredQty: qtys.deliveredQty,
      pickedQty: qtys.pickedQty,
      returnedQty: qtys.returnedQty,
      erpCategory: qtys.erpCategory,
    };
  });

  let categoryGroups: Awaited<ReturnType<typeof groupItemsByRootCategory>>;
  const auditCat = o.derived_by_category ?? null;
  if (auditCat && Object.keys(auditCat).length > 0) {
    categoryGroups = groupItemsByAuditCategory(
      itemsForGrouping,
      auditCat,
      o.derived_categories_present ?? null
    );
  } else {
    // Pre-mirror orders (no derived_delivery_by_category on audit yet).
    // Fall back to the per-shipment derivation so the card isn't blank.
    const fallbackByErpCategory = new Map<
      string,
      "delivered" | "in_transit"
    >();
    for (const s of shipments) {
      const cat = (s.item_category ?? "").toLowerCase().trim();
      if (!cat) continue;
      const status = (s.status ?? "").toLowerCase();
      const isDelivered = status === "delivered";
      const isInTransit =
        !!s.dispatched_at ||
        ["shipped", "in_transit", "dispatched", "packed"].includes(status);
      const prev = fallbackByErpCategory.get(cat);
      if (isDelivered) fallbackByErpCategory.set(cat, "delivered");
      else if (isInTransit && prev !== "delivered")
        fallbackByErpCategory.set(cat, "in_transit");
    }
    categoryGroups = await groupItemsByRootCategory(
      itemsForGrouping,
      fallbackByErpCategory
    );
  }
  const pollPending =
    !pollMeta?.erp_last_polled_at &&
    !!pollMeta?.created_at &&
    Date.now() - new Date(pollMeta.created_at).getTime() < 10 * 60_000;

  return {
    id: o.order_no,
    orderNumber: o.order_no,
    status: uiStatus(
      o.display_status,
      shipments.length,
      shipDelivered,
      o.sealed_pu,
      o.dispatched_pu
    ),
    paymentStatus:
      (o.payment_status ?? "").toUpperCase() === "SUCCESS"
        ? "paid"
        : (o.payment_status ?? "pending").toLowerCase(),
    subtotal: o.net_total ?? o.grand_total ?? 0,
    tax: o.tax_total ?? 0,
    shipping: 0,
    discount: 0,
    total: o.grand_total ?? 0,
    shippingAddress: {
      receiverName: ls.receiverName || o.customer_name || "",
      receiverPhone:
        (ls.receiverPhone || o.contact_mobile || "")
          .replace(/\D/g, "")
          .slice(-10),
      line1: ls.line1 || addrBlob || "—",
      line2: ls.line2 || "",
      city: ls.city || "",
      state: ls.state || "",
      pincode: ls.pincode || o.pincode || "",
    },
    placedAt: created,
    confirmedAt:
      (o.payment_status ?? "").toUpperCase() === "SUCCESS" ? created : null,
    shippedAt:
      shipments.find((s) => s.dispatched_at)?.dispatched_at ?? null,
    deliveredAt:
      shipments.find((s) => s.delivered_at)?.delivered_at ?? null,
    createdAt: created,
    items: items.map((it) => ({
      id: String(it.id),
      name: it.item_name ?? "Item",
      size: "",
      qty: it.qty ?? 0,
      unitPrice: Math.round(it.rate ?? 0),
      total: Math.round(it.amount ?? 0),
      imageUrl: imgUrl(it.image),
      bundleSelections: ((it.bundle_selections as
        | {
            componentProductId: string;
            name: string;
            qty: number;
            variantId: string;
            size: string;
          }[]
        | null
        | undefined) ?? null)?.map((s) => ({
        ...s,
        attributes: erpAttrsByVariant.get(s.variantId) ?? [],
      })) ?? null,
    })),
    payment: o.payment_status
      ? {
          provider: o.payment_flow ?? "ERP",
          status: o.payment_status,
          method: o.payment_mode,
        }
      : null,
    tracking: shipments.map((s) => ({
      partner: s.partner ?? "—",
      trackingNumber: s.tracking_number,
      status: s.status ?? "—",
      dispatchedAt: s.dispatched_at,
      deliveredAt: s.delivered_at,
    })),
    studentName: o.customer_name,
    enrollment: o.enrollment,
    categoryGroups,
    pollPending,
  };
}

/**
 * Local-DB fallback for the order detail page. Used when the order was
 * placed via shop checkout but hasn't been mirrored into the `erp.*`
 * tables yet (e.g. a fresh CCAvenue payment on a stack with no live ERP
 * sync). Looks up by either UUID or order_number, always scoped to the
 * current parent so cross-parent access is impossible.
 */
export async function getParentOrderDetailLocal(
  parentId: string,
  idOrOrderNumber: string
): Promise<ParentOrderDetail | null> {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idOrOrderNumber
    );
  const matcher = isUuid
    ? eq(orders.id, idOrOrderNumber)
    : eq(orders.orderNumber, idOrOrderNumber);

  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.parentId, parentId), matcher))
    .limit(1);
  if (!o) return null;

  const lines = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, o.id));

  const [pay] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, o.id))
    .limit(1);

  let studentName: string | null = null;
  let enrollment: string | null = null;
  if (o.studentId) {
    const [s] = await db
      .select({
        name: students.name,
        enrollmentNumber: students.enrollmentNumber,
      })
      .from(students)
      .where(eq(students.id, o.studentId))
      .limit(1);
    if (s) {
      studentName = s.name ?? null;
      enrollment = s.enrollmentNumber ?? null;
    }
  }

  const addr = (o.shippingAddress ?? {}) as Record<string, string | undefined>;

  // Multi-axis attribute enrichment, same as the ERP-path branch above.
  const localBundleVariantIds: string[] = [];
  for (const l of lines) {
    const bs = l.bundleSelections as
      | { variantId?: string }[]
      | null
      | undefined;
    if (Array.isArray(bs)) {
      for (const s of bs) if (s.variantId) localBundleVariantIds.push(s.variantId);
    }
  }
  const localAttrsByVariant = await attrsByVariantId(
    Array.from(new Set(localBundleVariantIds))
  );

  // Category-wise tracking for the local fallback. order_items here has
  // variant_id directly, so we can resolve sku → category in one shot
  // via product_variants → products.
  const variantIds = Array.from(
    new Set(
      lines.map((l) => l.variantId).filter((v): v is string => !!v)
    )
  );
  const variantMeta = await (async () => {
    const map = new Map<string, { sku: string | null; categoryId: string | null }>();
    if (variantIds.length === 0) return map;
    const r: any = await db.execute(sql`
      SELECT pv.id::text AS id, pv.sku, p.category_id::text AS category_id
        FROM product_variants pv
        LEFT JOIN products p ON p.id = pv.product_id
       WHERE pv.id IN (${sql.join(
         variantIds.map((v) => sql`${v}`),
         sql`, `
       )})
    `);
    const rs = (r?.rows ?? r ?? []) as Array<{
      id: string;
      sku: string | null;
      category_id: string | null;
    }>;
    for (const row of rs) {
      map.set(row.id, { sku: row.sku ?? null, categoryId: row.category_id ?? null });
    }
    return map;
  })();
  const qtysByCode = o.erpSoName
    ? await dispatchQtysByItemCode(o.erpSoName)
    : new Map<
        string,
        {
          deliveredQty: number;
          pickedQty: number;
          returnedQty: number;
          erpCategory: string | null;
        }
      >();
  // Local-only branch: no ERP shipment rows to map by category, so we
  // keep the order-level enum. (When ERP catches up, the call switches
  // to getParentOrderDetailFromErpMirror with per-category data.)
  const fallback: "delivered" | "in_transit" | "none" = o.deliveredAt
    ? "delivered"
    : o.shippedAt
      ? "in_transit"
      : "none";
  const categoryGroups = await groupItemsByRootCategory(
    lines.map((l) => {
      const meta = l.variantId ? variantMeta.get(l.variantId) : undefined;
      const qtys = (meta?.sku && qtysByCode.get(meta.sku)) || {
        deliveredQty: 0,
        pickedQty: 0,
        returnedQty: 0,
        erpCategory: null as string | null,
      };
      return {
        id: l.id,
        name: l.nameSnapshot ?? "Item",
        qty: l.qty ?? 0,
        categoryId: meta?.categoryId ?? null,
        deliveredQty: qtys.deliveredQty,
        pickedQty: qtys.pickedQty,
        returnedQty: qtys.returnedQty,
        erpCategory: qtys.erpCategory,
      };
    }),
    fallback
  );
  const pollPending =
    !o.erpLastPolledAt &&
    !!o.createdAt &&
    Date.now() - new Date(o.createdAt).getTime() < 10 * 60_000;

  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    // Local rows store paise (×100) — convert to rupees for the UI.
    subtotal: Math.round((o.subtotal ?? 0) / 100),
    tax: Math.round((o.tax ?? 0) / 100),
    shipping: Math.round((o.shipping ?? 0) / 100),
    discount: Math.round((o.discount ?? 0) / 100),
    total: Math.round((o.total ?? 0) / 100),
    shippingAddress: {
      receiverName: addr.receiverName ?? "",
      receiverPhone: addr.receiverPhone ?? "",
      line1: addr.line1 ?? "",
      line2: addr.line2,
      city: addr.city ?? "",
      state: addr.state ?? "",
      pincode: addr.pincode ?? "",
    },
    placedAt: o.placedAt ? o.placedAt.toISOString() : null,
    confirmedAt: o.confirmedAt ? o.confirmedAt.toISOString() : null,
    shippedAt: o.shippedAt ? o.shippedAt.toISOString() : null,
    deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    items: lines.map((l) => ({
      id: l.id,
      name: l.nameSnapshot,
      size: l.size,
      qty: l.qty,
      unitPrice: Math.round((l.unitPrice ?? 0) / 100),
      total: Math.round((l.total ?? 0) / 100),
      imageUrl: l.imageSnapshot ?? "",
      // bundle_selections is JSONB; we accept whatever was written at
      // checkout. The TS cast narrows it to the shape our UI expects;
      // the persisted shape is enforced by app/api/cart Zod schema.
      bundleSelections: ((l.bundleSelections as
        | {
            componentProductId: string;
            name: string;
            qty: number;
            variantId: string;
            size: string;
          }[]
        | null
        | undefined) ?? null)?.map((s) => ({
        ...s,
        attributes: localAttrsByVariant.get(s.variantId) ?? [],
      })) ?? null,
    })),
    payment: pay
      ? {
          provider: pay.provider,
          status: pay.status,
          method: pay.method ?? pay.paymentMode ?? null,
        }
      : null,
    tracking: [],
    studentName,
    enrollment,
    categoryGroups,
    pollPending,
  };
}
