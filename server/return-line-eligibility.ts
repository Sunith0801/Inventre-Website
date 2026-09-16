import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fallbackBundleComponents, loadBookkitCategoryTree } from "@/server/bundle-fallback";
import { RETURNS_WINDOW_DAYS } from "@/lib/exchange-shared";

function rows<T>(r: unknown): T[] {
  return r as unknown as T[];
}

/** Base name of a decoded shipment description / component name — strip the
 *  " · Colour · Size" suffix so a component matches its parcel row by name
 *  even when the ordered SKU's size differs from the dispatched size. Mirrors
 *  `normName` in lib/erp-customer-orders.ts (the order-page resolver). */
function baseName(s: string | null | undefined): string {
  return (s ?? "").split(" · ")[0].trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Coarse-map one value of audit's `derived_delivery_by_category` map (e.g.
 * "Delivered", "Delivered · 1 pending", "Not Delivered", "Out For Delivery")
 * to a delivered / not-delivered floor. EXACT mirror of `coarseCatStatus` in
 * lib/erp-customer-orders.ts, which is what the order-page badge uses — the
 * two must never disagree. "Delivered · N pending" IS a delivered floor; the
 * N held-back pieces are pinned separately by packing_state.
 */
function categoryFloorDelivered(raw: string | null | undefined): boolean {
  const s = (raw ?? "").toLowerCase();
  if (!s) return false;
  if (s.includes("out for delivery") || s.includes("ofd")) return false;
  if (s.includes("not") && s.includes("deliver")) return false;
  return s.includes("deliver");
}

/**
 * SQL predicate: TRUE when audit's category floor for the line's own category
 * is SETTLED — exactly "Delivered", with no "· N pending" shortfall remainder.
 *
 * Audit appends that remainder for every piece it still counts as held back,
 * so a bare "Delivered" is audit stating nothing is short in that category. A
 * `packing_state` pin surviving under a settled floor is therefore a stale
 * packing-time snapshot (audit never clears the pin when a line flagged 'oos'
 * or 'packed' is later found and shipped) and must NOT block an exchange /
 * missing request. Lines under a "Delivered · N pending" floor keep their pin
 * — audit is still counting them short (SAL-ORD-2026-34537).
 *
 * EXACT mirror of `SETTLED_CATEGORY_SQL` in lib/erp-customer-orders.ts, which
 * is what the order-page badge uses; the badge and the gate must never
 * disagree ("Pending badge ⇒ not selectable"). Requires the query to join
 * erp.sales_orders as `so` and alias erp.sales_order_items as `i`.
 */
const SETTLED_CATEGORY_SQL = sql`
  coalesce(
    CASE WHEN jsonb_typeof((so.raw::jsonb)->'derived_delivery_by_category') = 'object'
         THEN (so.raw::jsonb)->'derived_delivery_by_category'
                ->>lower(trim(coalesce(i.category, '')))
    END, '') ~* '^delivered( *· *0+ +pending)?$'`;

/**
 * Audit's whole `derived_delivery_by_category` map for an order, coarse-mapped
 * to a per-category delivered floor: Map<category, delivered>. Empty when the
 * order has no mirror row / no map (legacy orders) → callers fall back to the
 * raw parcel rows + the order-level flag exactly as before.
 */
async function loadCategoryFloor(orderNo: string): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!orderNo) return out;
  const r = rows<{ cat: string; val: string | null }>(
    await db.execute(sql`
      SELECT lower(trim(kv.key)) AS cat, kv.value AS val
        FROM erp.sales_orders so
        CROSS JOIN LATERAL jsonb_each_text(
          -- erp.sales_orders.raw is json (NOT jsonb) — cast before any
          -- jsonb_* call or postgres errors 42883 at runtime.
          CASE WHEN jsonb_typeof((so.raw::jsonb)->'derived_delivery_by_category') = 'object'
               THEN (so.raw::jsonb)->'derived_delivery_by_category'
               ELSE '{}'::jsonb END
        ) AS kv(key, value)
       WHERE so.erp_name = ${orderNo}
    `),
  );
  for (const x of r) out.set(x.cat, categoryFloorDelivered(x.val));
  return out;
}

/**
 * Categories this order delivered as ONE parcel-level `outward_shipments` row
 * (blank `item_code`) — how Porter / shipped_to_school / manual / auto_bookkit
 * deliveries are recorded: a whole category handed over in a single drop, with
 * no per-line carrier scan ever posted.
 *
 * The order-page category card already bumps to "delivered" off exactly these
 * rows (erp-customer-orders.ts `bestFromShipments`), but this gate could not
 * see them: `classifyReturnItems` reads only per-line CODED rows plus audit's
 * `derived_delivery_by_category`, and for a Porter drop audit routinely leaves
 * that map at "Pending" / "Packed" for weeks (custom_display_status stays
 * "Not Yet Delivered"). Result on prod: the card read Delivered while neither
 * Request-exchange nor Report-missing appeared — SAL-ORD-2026-24501 (bookkit,
 * porter SMSAW-PORTER-00679, delivered 04 Aug), SAL-ORD-2026-25490 and 96 more.
 *
 * Blank item_code ONLY. A coded delivered row already speaks for its own line
 * via `rank >= 2`; letting one coded row settle its whole category would run
 * over the held-back (`packing_state`) lines that deliberately read pending.
 */
async function loadParcelDeliveredCategories(
  orderNo: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!orderNo) return out;
  // Supersession mirrors the order page (erp-customer-orders.ts
  // `isSupersededShipment`): a delivered parcel dispatched strictly BEFORE the
  // newest attempt in its own category is a past attempt — a fresh parcel is
  // in flight for that category, so it must not settle it (SAL-ORD-2026-36818:
  // porter drop 18 Jul, DTDC reship dispatched 3 Aug and still in transit).
  const r = rows<{ cat: string | null }>(
    await db.execute(sql`
      WITH s AS (
        SELECT lower(trim(coalesce(item_category, ''))) AS cat,
               item_code, lower(status) AS status, dispatched_at
          FROM erp.outward_shipments
         WHERE order_erp_name = ${orderNo}
           AND is_deleted = false
      ),
      latest AS (
        SELECT cat, max(dispatched_at) AS dispatched_at FROM s GROUP BY cat
      )
      SELECT DISTINCT s.cat AS cat
        FROM s
        JOIN latest l ON l.cat = s.cat
       WHERE (s.item_code IS NULL OR s.item_code = '')
         AND s.status = 'delivered'
         AND (s.dispatched_at IS NULL OR l.dispatched_at IS NULL
              OR s.dispatched_at >= l.dispatched_at)
    `),
  );
  for (const x of r) if (x.cat) out.add(x.cat);
  return out;
}

/**
 * Order-item ids on this order that are COMPOSED lines — a Magic Box
 * (`products.kind = 'magic_box'`) or a kit/bookkit (`kind = 'kit'`).
 *
 * Whole-box requests are retired (2026-07-08 item-wise model): a composed line
 * can only ever be exchanged / reported missing component-by-component, so a
 * submitted line for one of these MUST carry a component path. The storefront
 * picker already renders only component rows (ExchangeForm / MissingForm hold
 * `scope = "items"`), but that was UI-only — this set lets the create paths
 * enforce it so a crafted or stale submission can't take out the whole box.
 */
export async function getComposedOrderItemIds(orderId: string): Promise<Set<string>> {
  const r = rows<{ id: string }>(
    await db.execute(sql`
      SELECT oi.id::text AS id
        FROM order_items oi
        JOIN product_variants pv ON pv.id = oi.variant_id
        JOIN products p ON p.id = pv.product_id
       WHERE oi.order_id = ${orderId}
         AND p.kind IN ('magic_box', 'kit')
    `),
  );
  return new Set(r.map((x) => x.id));
}

/**
 * Lines the customer does NOT yet physically have — held back / out of stock
 * / still out-for-delivery — must not be exchangeable or reportable-as-missing.
 * We already know they didn't arrive and will send them in a later shipment,
 * so a "missing" claim (or an exchange) on them is wrong: it isn't missing,
 * it's pending.
 *
 * This mirrors the per-item badge on /shop/orders/[id]
 * (lib/erp-customer-orders.ts §"Per-item badge status"): a STANDALONE line is
 * "held back" when the order is tracked per-line (audit stamped item_codes on
 * its outward shipments) AND this line's own item_code has NO `delivered`
 * shipment row (out-for-delivery or absent both count as not-yet-received).
 * Kit / Magic-Box / bundle parents ship as one blank-item_code parcel, so
 * they never enter per-line mode and stay eligible under the order-level
 * delivered gate — filtering them would wrongly hide a delivered bookkit.
 *
 * Returns the set of LOCAL order_items.id that are ineligible. An empty set
 * means "nothing held back" (legacy / blank-code-only orders, or every line
 * delivered), so the caller keeps its existing order-level gate behaviour.
 */
export async function getHeldBackOrderItemIds(
  orderId: string,
  orderNo: string,
): Promise<Set<string>> {
  const held = new Set<string>();
  if (!orderNo) return held;

  // Per-line shipment rank keyed by item_code (delivered=2, OFD=1, else 0),
  // plus the row's own item_category for the category-floor rescue below.
  // Blank item_codes = parcel-level dispatch (bookkit / magic box) — ignored.
  const shipRows = rows<{ item_code: string; rank: number; item_category: string | null }>(
    await db.execute(sql`
      SELECT item_code,
             max(CASE lower(status)
                   WHEN 'delivered'        THEN 2
                   WHEN 'out_for_delivery' THEN 1
                   ELSE 0 END)::int AS rank,
             min(lower(nullif(trim(coalesce(item_category, '')), ''))) AS item_category
        FROM erp.outward_shipments
       WHERE order_erp_name = ${orderNo}
         AND is_deleted = false
         AND item_code IS NOT NULL AND item_code <> ''
       GROUP BY item_code
    `),
  );
  // Audit's held-back pin. `erp.sales_order_items.packing_state` is non-null
  // ('oos' / 'packed' / 'pending') exactly when audit has flagged the line as
  // NOT yet handed over — a fact that lives only in audit's packing_exceptions
  // and is invisible in `outward_shipments`. The order-detail page has honoured
  // this since 2026-07-15 (erp-customer-orders.ts `heldBackCodes`), but this
  // gate did not, so an out-of-stock line whose parcel shipped could still be
  // exchanged. Applied independently of the per-line shipment rank below,
  // because a blank-code-only order has no rank rows at all yet can still
  // carry packing_state.
  const packingRows = rows<{ item_code: string }>(
    await db.execute(sql`
      SELECT DISTINCT i.item_code
        FROM erp.sales_order_items i
        JOIN erp.sales_orders so ON so.erp_name = i.order_erp_name
       WHERE i.order_erp_name = ${orderNo}
         AND i.packing_state IS NOT NULL
         AND i.item_code IS NOT NULL AND i.item_code <> ''
         AND NOT (${SETTLED_CATEGORY_SQL})
    `),
  );
  const packingHeldCodes = new Set(packingRows.map((r) => r.item_code));

  // No per-line tracking AND no packing pin → nothing held back; the
  // order-level delivered gate governs (legacy / blank-code-only orders).
  if (shipRows.length === 0 && packingHeldCodes.size === 0) return held;
  const perLineMode = shipRows.length > 0;

  const rankByCode = new Map<string, number>();
  const shipCatByCode = new Map<string, string | null>();
  for (const r of shipRows) {
    rankByCode.set(r.item_code, r.rank);
    shipCatByCode.set(r.item_code, r.item_category);
  }
  // Audit's per-category delivery floor + the whole-parcel floor — the SAME
  // two signals classifyReturnItems and the order-page badge already apply.
  // Without them this gate held back every line whose carrier row is stuck at
  // `dispatched`, which is the normal end state for a Porter / school drop:
  // the courier posts no per-line delivered scan, so audit settles the
  // CATEGORY instead. SAL-ORD-2026-34410 — uniform floor "Delivered", polo +
  // hoodie rows frozen at `dispatched` — badged Delivered on the order page
  // yet showed "Pending delivery — Exchange request is not available yet" in
  // the picker, because the badge-parity union can only ever REMOVE
  // selectability, never restore what this gate took away.
  const catFloor = await loadCategoryFloor(orderNo);
  const parcelFloor = await loadParcelDeliveredCategories(orderNo);

  // Local lines with their resolved item_code + whether they're a bundle
  // parent (kit / magic box / sub-bundle, or carrying bundle_selections).
  const lineRows = rows<{
    id: string;
    item_code: string | null;
    is_bundle: boolean;
  }>(
    await db.execute(sql`
      SELECT oi.id::text AS id,
             coalesce(nullif(pv.erp_name, ''), nullif(pv.sku, ''),
                      nullif(p.erp_name, ''), nullif(p.item_code, '')) AS item_code,
             (
               p.kind IN ('kit', 'magic_box', 'sub_bundle')
               OR (oi.bundle_selections IS NOT NULL
                   AND jsonb_typeof(oi.bundle_selections) = 'array'
                   AND jsonb_array_length(oi.bundle_selections) > 0)
             ) AS is_bundle
        FROM order_items oi
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        LEFT JOIN products p ON p.id = pv.product_id
       WHERE oi.order_id = ${orderId}
    `),
  );

  for (const l of lineRows) {
    if (l.is_bundle) continue; // parcel-level → stays eligible
    if (!l.item_code) continue; // can't resolve a code → don't over-hide
    // Audit says this line is not with the customer, whatever the parcel says
    // — UNLESS its own shipment row says delivered. `packing_state` is a
    // packing-time snapshot audit never clears when a line pinned 'oos' is
    // later found and shipped (SAL-ORD-2026-34839). Mirrors the order-page
    // badge guard in erp-customer-orders.ts: the carrier row outranks the
    // stale pin, so the button and the badge never disagree. Rank 2 here is
    // strictly `delivered` — an out-for-delivery line stays held back.
    if (packingHeldCodes.has(l.item_code) && (rankByCode.get(l.item_code) ?? 0) < 2) {
      held.add(l.id);
      continue;
    }
    if (!perLineMode) continue; // no per-line rank rows → order-level gate governs
    const rank = rankByCode.get(l.item_code) ?? 0;
    if (rank >= 2) continue; // own delivered scan
    // Stuck at `dispatched` (rank 0) but audit has settled the row's OWN
    // category → delivered, exactly as classifyReturnItems rules. Rank 1
    // (out_for_delivery) is NEVER rescued: that is the carrier saying the
    // parcel is not with the customer yet.
    const shipCat = shipCatByCode.get(l.item_code) ?? null;
    if (
      rank < 1 &&
      shipCat &&
      (catFloor.get(shipCat) === true || parcelFloor.has(shipCat))
    )
      continue;
    held.add(l.id); // pending OR out-for-delivery → held back
  }
  return held;
}

/**
 * Per-ITEM eligibility for the customer exchange/missing flow (item-wise
 * model, 2026-07-08). For each local order_item returns:
 *   • delivered   — this item has physically arrived (per-line
 *                   `outward_shipments` delivered status, OR the order-level
 *                   delivered flag for bundle / bookkit / magic-box parcels
 *                   and legacy blank-code orders that ship as one parcel).
 *   • deliveredAt — the date this item was delivered (per-item shipment
 *                   `delivered_at`; falls back to the order delivery date for
 *                   non-per-line items).
 *
 * This is the single source of truth the forms + button gate use to decide,
 * PER ITEM: show as eligible (delivered) / hide (not delivered). The
 * active-request lock (item already in a non-rejected request) is layered on
 * top by the callers.
 *
 * The post-delivery time window is ORDER-level, not per item — see
 * computeReturnsWindow below (7 days from the day the last item arrived).
 */
export interface ItemEligibility {
  delivered: boolean;
  deliveredAt: Date | null;
}

/**
 * Order-level request window (2026-09-16). The parent has RETURNS_WINDOW_DAYS
 * calendar days, counted from the day the LAST item of the order was
 * delivered, to raise an Exchange / Missing request.
 *
 *   • Not every item delivered yet → window OPEN (no expiry): the clock only
 *     starts once the whole order has arrived, so the pieces still on the way
 *     can never time out before they land.
 *   • All delivered but some delivery date unknown → OPEN (never block on a
 *     date we don't have — same rule the original 06-26 window used).
 *   • Otherwise expiresAt = IST midnight at the end of the 7th calendar day
 *     after the latest delivery date; expired once `now` reaches it.
 */
export interface ReturnsWindow {
  allDelivered: boolean;
  lastDeliveredAt: Date | null;
  /** Exclusive cut-off instant; null = no expiry (yet). */
  expiresAt: Date | null;
  expired: boolean;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function computeReturnsWindow(
  cls: Map<string, ItemEligibility>,
  now: Date = new Date(),
): ReturnsWindow {
  const items = [...cls.values()];
  const open: ReturnsWindow = {
    allDelivered: false,
    lastDeliveredAt: null,
    expiresAt: null,
    expired: false,
  };
  if (items.length === 0) return open;
  if (!items.every((e) => e.delivered)) return open;
  if (items.some((e) => !e.deliveredAt)) return { ...open, allDelivered: true };
  const last = items.reduce<Date>(
    (m, e) => (e.deliveredAt! > m ? e.deliveredAt! : m),
    items[0].deliveredAt!,
  );
  // Calendar day of delivery in IST, then +N days +1 → exclusive midnight.
  const ist = new Date(last.getTime() + IST_OFFSET_MS);
  const expiresAt = new Date(
    Date.UTC(
      ist.getUTCFullYear(),
      ist.getUTCMonth(),
      ist.getUTCDate() + RETURNS_WINDOW_DAYS + 1,
    ) - IST_OFFSET_MS,
  );
  return {
    allDelivered: true,
    lastDeliveredAt: last,
    expiresAt,
    expired: now.getTime() >= expiresAt.getTime(),
  };
}

export async function classifyReturnItems(
  orderId: string,
  orderNo: string,
  orderLevelDelivered: boolean,
  orderDeliveredAt: Date | null,
): Promise<Map<string, ItemEligibility>> {
  const out = new Map<string, ItemEligibility>();

  // Per-line shipment status + delivered_at keyed by item_code. Blank
  // item_codes = parcel-level dispatch (bookkit / magic box) — ignored here;
  // those lines fall back to the order-level signals below.
  const shipRows = rows<{
    item_code: string;
    rank: number;
    delivered_at: string | null;
    item_category: string | null;
  }>(
    await db.execute(sql`
      SELECT item_code,
             max(CASE lower(status)
                   WHEN 'delivered'        THEN 2
                   WHEN 'out_for_delivery' THEN 1
                   ELSE 0 END)::int AS rank,
             max(delivered_at) AS delivered_at,
             min(lower(nullif(trim(coalesce(item_category, '')), ''))) AS item_category
        FROM erp.outward_shipments
       WHERE order_erp_name = ${orderNo}
         AND is_deleted = false
         AND item_code IS NOT NULL AND item_code <> ''
       GROUP BY item_code
    `),
  );
  const hasPerLine = shipRows.length > 0;
  const rankByCode = new Map<string, number>();
  const deliveredAtByCode = new Map<string, Date | null>();
  const categoryByCode = new Map<string, string | null>();
  for (const r of shipRows) {
    rankByCode.set(r.item_code, r.rank);
    deliveredAtByCode.set(r.item_code, r.delivered_at ? new Date(r.delivered_at) : null);
    categoryByCode.set(r.item_code, r.item_category);
  }

  // Audit's per-category delivery FLOOR — the same signal the order-page badge
  // (erp-customer-orders.ts: `own !== null` → catDelivered ? "delivered" :
  // "pending") and the exchange/missing picker (getPendingComponentVariantIds,
  // getBookkitParcelDelivered) already honour. This gate did NOT, which is how
  // an order could badge every piece "Delivered" and still show no Request-
  // exchange / Report-missing button at all (SAL-ORD-2026-33270: a Porter
  // uniform parcel whose 11 per-item rows sit at `dispatched` forever because
  // the courier never posts a per-line delivered scan — audit settles the
  // CATEGORY instead, `derived_delivery_by_category.uniform = "Delivered"`).
  //
  // The floor can only ADD eligibility, never remove it, and the button it
  // un-hides merely OPENS the per-item picker — which applies its own
  // per-component gates on top. So a category audit has NOT settled stays shut.
  const catFloor = await loadCategoryFloor(orderNo);
  const anyCategoryDelivered = Array.from(catFloor.values()).some(Boolean);

  // Second floor, same spirit: categories physically delivered as one
  // blank-item_code parcel (Porter & co). Audit's category map lags these by
  // weeks, so without this the card badges Delivered and the button stays
  // hidden. See loadParcelDeliveredCategories.
  const parcelFloor = await loadParcelDeliveredCategories(orderNo);
  const anyParcelDelivered = parcelFloor.size > 0;

  const lineRows = rows<{
    id: string;
    item_code: string | null;
    is_bundle: boolean;
    is_magic_box: boolean;
  }>(
    await db.execute(sql`
      SELECT oi.id::text AS id,
             coalesce(nullif(pv.erp_name, ''), nullif(pv.sku, ''),
                      nullif(p.erp_name, ''), nullif(p.item_code, '')) AS item_code,
             (
               p.kind IN ('kit', 'magic_box', 'sub_bundle')
               OR (oi.bundle_selections IS NOT NULL
                   AND jsonb_typeof(oi.bundle_selections) = 'array'
                   AND jsonb_array_length(oi.bundle_selections) > 0)
             ) AS is_bundle,
             (p.kind = 'magic_box') AS is_magic_box
        FROM order_items oi
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        LEFT JOIN products p ON p.id = pv.product_id
       WHERE oi.order_id = ${orderId}
    `),
  );

  for (const l of lineRows) {
    const perLine =
      hasPerLine && !l.is_bundle && !!l.item_code && rankByCode.has(l.item_code);
    let delivered: boolean;
    let deliveredAt: Date | null;
    if (perLine) {
      const rank = rankByCode.get(l.item_code!) ?? 0;
      // Has a row but no delivered scan → delivered when audit has settled the
      // row's own category (mirrors the badge). NOT out-for-delivery: that is
      // a live "not yet with the customer" signal from the carrier itself, and
      // categoryFloorDelivered() already refuses an OFD category floor.
      const cat = categoryByCode.get(l.item_code!) ?? null;
      delivered =
        rank >= 2 ||
        (rank < 1 &&
          !!cat &&
          (catFloor.get(cat) === true || parcelFloor.has(cat)));
      deliveredAt = delivered
        ? deliveredAtByCode.get(l.item_code!) ?? orderDeliveredAt
        : null;
    } else {
      // Bundle / bookkit / magic-box parcel, or an order with no per-line
      // tracking → governed by the order-level delivered signal + date, with
      // audit's category floor as a second route: a magic box is ONE local
      // order_item spanning several parcels, so the moment audit settles ANY
      // of its categories the parent must be able to open the picker for that
      // category's pieces. The picker gates the still-in-transit ones.
      delivered = orderLevelDelivered || anyCategoryDelivered || anyParcelDelivered;
      deliveredAt = delivered ? orderDeliveredAt : null;
    }
    out.set(l.id, {
      delivered,
      deliveredAt,
    });
  }
  return out;
}

/**
 * order_item ids that are currently in a NON-rejected exchange (returns) OR
 * missing claim — "locked" per the item-wise model. Cross-flow at the ITEM
 * level: an item in an active missing claim also blocks a new exchange on it,
 * and vice-versa. Rejected requests DON'T lock (the rejected-exception frees
 * the item). Scoped to the ORDER, not the parent, so a care-team request
 * locks the item for everyone in the family.
 *
 * Returns Map<order_item_id, returnNumber|claimNumber|null> so the picker can
 * show which request already covers the item.
 */
export async function getLockedOrderItemIds(
  orderId: string,
): Promise<Map<string, string | null>> {
  const locked = new Map<string, string | null>();
  const exRows = rows<{ order_item_id: string; ref: string | null }>(
    await db.execute(sql`
      SELECT ri.order_item_id::text AS order_item_id, r.return_number AS ref
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
       WHERE r.order_id = ${orderId}
         AND r.kind = 'exchange'
         AND r.status <> 'rejected'
    `),
  );
  for (const r of exRows) if (!locked.has(r.order_item_id)) locked.set(r.order_item_id, r.ref);
  const mcRows = rows<{ order_item_id: string; ref: string | null }>(
    await db.execute(sql`
      SELECT mci.order_item_id::text AS order_item_id, c.claim_number AS ref
        FROM missing_item_claim_items mci
        JOIN missing_item_claims c ON c.id = mci.claim_id
       WHERE c.order_id = ${orderId}
         AND c.status <> 'rejected'
    `),
  );
  for (const r of mcRows) if (!locked.has(r.order_item_id)) locked.set(r.order_item_id, r.ref);
  return locked;
}

/**
 * COMPONENT-LEVEL lock (2026-07-09) — supersedes the order_item-level
 * `getLockedOrderItemIds` for bundle / Magic-Box / bookkit parents.
 *
 * A Magic Box is ONE `order_items` row whose components all share that single
 * id, so the order_item-level lock (above) marked the WHOLE box locked the
 * moment any one component entered a request — collapsing the box card and
 * preventing a follow-up request for the remaining, still-eligible components.
 *
 * This resolves the lock PER COMPONENT using the only per-component identity
 * that is persisted: `return_items.requested_component_path` /
 * `missing_item_claim_items.missing_component_path` (`{variantId, componentName}`).
 * `return_items.variant_id` is the BOX variant for every component, so it
 * can't discriminate — the path is the sole signal. Components are matched by
 * BOTH a UUID-variant key and a normalized-name key (mirroring how
 * `lib/audit-item-match.ts` matches audit-sent components by name), so
 * care-team requests synced from Audit lock correctly too.
 *
 * Per order_item we distinguish:
 *   • baseLocked — the WHOLE box (or a standalone item) is in a non-rejected
 *     request (its `return_items` row carries NO component path). Locks the
 *     kit-parent AND every component.
 *   • comps      — specific components under a non-rejected request. Locks
 *     those components only; the parent stays open for the rest, but the
 *     "whole box" option is disabled (you can't send back the whole box while
 *     part of it is already out).
 *
 * Rejected requests don't lock (the rejected-exception frees the component).
 * Scoped to the ORDER so a care-team request locks the component family-wide.
 */
export interface ItemLockInfo {
  /** Whole box / standalone under a non-rejected request. */
  baseLocked: boolean;
  baseRef: string | null;
  /** sigKey (`v:<uuid>` or `n:<normname>`) → RTN/claim ref of the request
   *  that already covers that component. */
  comps: Map<string, string | null>;
}

/** Normalize a component name for stable matching (case/space-insensitive). */
export function normalizeComponentName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Signature keys a component identity can be matched under. A UUID variant
 *  yields a `v:` key; a non-blank name yields an `n:` key. Both are emitted so
 *  either side of the match (stored row ↔ live unit) can key on whatever it
 *  has (recovered-composition components have no stored variant, only a name). */
function componentSigKeys(
  variantId: string | null | undefined,
  name: string | null | undefined,
): string[] {
  const keys: string[] = [];
  if (variantId && UUID_RE.test(variantId)) keys.push(`v:${variantId.toLowerCase()}`);
  if (name && name.trim()) keys.push(`n:${normalizeComponentName(name)}`);
  return keys;
}

export async function getLockedComponentSignatures(
  orderId: string,
): Promise<Map<string, ItemLockInfo>> {
  const out = new Map<string, ItemLockInfo>();
  const info = (oid: string): ItemLockInfo => {
    let i = out.get(oid);
    if (!i) {
      i = { baseLocked: false, baseRef: null, comps: new Map() };
      out.set(oid, i);
    }
    return i;
  };
  const absorb = (
    oid: string,
    ref: string | null,
    compVariant: string | null,
    compName: string | null,
  ) => {
    const i = info(oid);
    const keys = componentSigKeys(compVariant, compName);
    if (keys.length === 0) {
      // No component path (whole box / standalone) OR an unidentifiable path →
      // lock the whole item conservatively.
      i.baseLocked = true;
      if (!i.baseRef) i.baseRef = ref;
      return;
    }
    for (const k of keys) if (!i.comps.has(k)) i.comps.set(k, ref);
  };

  const exRows = rows<{
    order_item_id: string;
    ref: string | null;
    comp_variant: string | null;
    comp_name: string | null;
  }>(
    await db.execute(sql`
      SELECT ri.order_item_id::text AS order_item_id,
             r.return_number AS ref,
             ri.requested_component_path ->> 'variantId'     AS comp_variant,
             ri.requested_component_path ->> 'componentName' AS comp_name
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
       WHERE r.order_id = ${orderId}
         AND r.kind = 'exchange'
         AND r.status <> 'rejected'
    `),
  );
  for (const r of exRows) absorb(r.order_item_id, r.ref, r.comp_variant, r.comp_name);

  const mcRows = rows<{
    order_item_id: string;
    ref: string | null;
    comp_variant: string | null;
    comp_name: string | null;
  }>(
    await db.execute(sql`
      SELECT mci.order_item_id::text AS order_item_id,
             c.claim_number AS ref,
             mci.missing_component_path ->> 'variantId'     AS comp_variant,
             mci.missing_component_path ->> 'componentName' AS comp_name
        FROM missing_item_claim_items mci
        JOIN missing_item_claims c ON c.id = mci.claim_id
       WHERE c.order_id = ${orderId}
         AND c.status <> 'rejected'
    `),
  );
  for (const r of mcRows) absorb(r.order_item_id, r.ref, r.comp_variant, r.comp_name);

  return out;
}

/** Lock state for a UNIT in the picker (kit parent / component / standalone).
 *  Returns whether it's locked, the covering request ref, and — for kit
 *  parents — whether SOME (but not all) components are locked so the form can
 *  keep the box open while disabling the "whole box" option. */
export function lockStateForUnit(
  info: ItemLockInfo | undefined,
  unit: {
    isKitParent?: boolean;
    isKitComponent?: boolean;
    variantId?: string | null;
    name?: string | null;
  },
): { locked: boolean; ref: string | null; someComponentsLocked: boolean } {
  if (!info) return { locked: false, ref: null, someComponentsLocked: false };
  const someComponentsLocked = info.comps.size > 0;
  if (unit.isKitParent) {
    // Whole-box unit: collapse ONLY when the whole box is already out.
    return { locked: info.baseLocked, ref: info.baseRef, someComponentsLocked };
  }
  if (unit.isKitComponent) {
    if (info.baseLocked) return { locked: true, ref: info.baseRef, someComponentsLocked };
    for (const k of componentSigKeys(unit.variantId, unit.name)) {
      if (info.comps.has(k)) return { locked: true, ref: info.comps.get(k) ?? null, someComponentsLocked };
    }
    return { locked: false, ref: null, someComponentsLocked };
  }
  // Standalone item — comps is always empty for these; only baseLocked applies.
  return { locked: info.baseLocked, ref: info.baseRef, someComponentsLocked: false };
}

/** Server-side guard: is a SUBMITTED line (order_item + optional component
 *  path) already locked? A component line is blocked when its own signature is
 *  locked or the whole box is locked; a no-path line (whole box / standalone)
 *  is blocked when the whole box is locked OR any component of it is already
 *  out (comps.size > 0 — only bundle parents ever have comps). */
export function lockStateForSubmittedLine(
  info: ItemLockInfo | undefined,
  componentPath: { variantId?: unknown; componentName?: unknown } | null | undefined,
): { locked: boolean; ref: string | null } {
  if (!info) return { locked: false, ref: null };
  if (info.baseLocked) return { locked: true, ref: info.baseRef };
  const vid = typeof componentPath?.variantId === "string" ? componentPath.variantId : null;
  const nm = typeof componentPath?.componentName === "string" ? componentPath.componentName : null;
  const keys = componentSigKeys(vid, nm);
  if (keys.length > 0) {
    for (const k of keys) if (info.comps.has(k)) return { locked: true, ref: info.comps.get(k) ?? null };
    return { locked: false, ref: null };
  }
  // No identifiable component path → whole-box / standalone submission.
  if (info.comps.size > 0) {
    const first = info.comps.values().next().value ?? null;
    return { locked: true, ref: first };
  }
  return { locked: false, ref: null };
}

/**
 * Per-item_category parcel delivery for a magic box / bookkit order
 * (2026-07-09). A magic box splits into SEPARATE parcels that deliver at
 * different times — the uniforms (item_category='uniform', shipped with real
 * per-item_codes) and the BOOKKIT (item_category='bookkit', shipped as ONE
 * blank-item_code parcel). The books have no per-item_code shipment rows, so
 * the per-line delivered gate (classifyReturnItems) can't see them and the
 * order-level delivered flag (true once the uniforms land) wrongly makes the
 * still-in-transit books look exchangeable/reportable.
 *
 * This returns whether the BOOKKIT parcel has been delivered:
 *   • true  — a bookkit-category shipment row is `delivered`
 *   • false — bookkit-category rows exist but none delivered (still dispatched
 *             / in_transit / ready_for_dispatch) → hide the book components
 *   • null  — no bookkit-category rows at all (legacy / non-split order) →
 *             UNKNOWN, don't gate (fall back to the order-level behaviour)
 */
export async function getBookkitParcelDelivered(
  orderNo: string,
): Promise<boolean | null> {
  if (!orderNo) return null;
  // Audit's per-category floor wins over the raw parcel rows — the SAME signal
  // the order-page badge uses (`derived_delivery_by_category`, see
  // erp-customer-orders.ts `coarseCatStatus`). A box's books ship as a single
  // blank-item_code parcel, so `outward_shipments` can carry a stale/superseded
  // bookkit row (a cancelled DTDC parcel, or a later reship still "dispatched")
  // long after audit has settled the category as Delivered. Without this, the
  // gate disagreed with the badge and greyed out books the order page shows as
  // delivered — 452 orders on prod (2026-07-28), incl. SAL-ORD-2026-27372.
  const catRows = rows<{ s: string | null }>(
    await db.execute(sql`
      SELECT raw->'derived_delivery_by_category'->>'bookkit' AS s
        FROM erp.sales_orders
       WHERE erp_name = ${orderNo}
       LIMIT 1
    `),
  );
  const cat = (catRows[0]?.s ?? "").toLowerCase();
  if (cat) {
    if (cat.includes("out for delivery") || cat.includes("ofd")) return false;
    if (cat.includes("not") && cat.includes("deliver")) return false;
    if (cat.includes("deliver")) return true;
    // Anything else (unrecognised wording) → fall through to the parcel rows.
  }
  const r = rows<{ n: number; delivered: number }>(
    await db.execute(sql`
      SELECT count(*)::int AS n,
             max(CASE lower(status) WHEN 'delivered' THEN 1 ELSE 0 END)::int AS delivered
        FROM erp.outward_shipments
       WHERE order_erp_name = ${orderNo}
         AND is_deleted = false
         AND lower(coalesce(item_category, '')) = 'bookkit'
    `),
  );
  const row = r[0];
  if (!row || row.n === 0) return null; // no bookkit parcel info → don't gate
  return row.delivered === 1;
}

/** effectiveKind mirror (see exchange/new page): a "bookkit"-named kit
 *  resolves to a book leaf, and kind='book' is a book. */
function isBookKind(rawKind: string | null | undefined, name: string | null | undefined): boolean {
  if (rawKind === "kit" && (name ?? "").toLowerCase().includes("bookkit")) return true;
  return rawKind === "book";
}

/**
 * SERVER-SIDE enforcement of the bookkit-parcel gate.
 *
 * The storefront disables (greys) book components whose bookkit parcel hasn't
 * been delivered yet — they're pending, not missing/exchangeable — but that
 * gate lived ONLY in the page render. This is the server counterpart: when an
 * order's bookkit parcel is undelivered (getBookkitParcelDelivered === false),
 * it returns the normalized names of every book leaf currently in transit, so
 * createExchange / createMissingClaim can reject a submission that targets one
 * (a crafted request, or a stale client). Empty set = not gated (parcel
 * delivered, or no bookkit parcel info at all → fall through to normal gates).
 *
 * Book leaves are derived from the SAME sources the page uses: whole-item
 * bookkits + nested bookkit components → loadBookkitCategoryTree leaves;
 * recovered-composition boxes → fallback components with a book kind. Matching
 * is by normalized component NAME (the box variant can't discriminate leaves),
 * consistent with the component-lock signatures. Uniform components are never
 * books, so they are never blocked here.
 */
export async function getUndeliveredBookComponentNames(
  orderId: string,
  orderNo: string,
  schoolId: string | null,
): Promise<Set<string>> {
  const names = new Set<string>();
  if ((await getBookkitParcelDelivered(orderNo)) !== false) return names;

  const add = (n: string | null | undefined) => {
    if (n && n.trim()) names.add(normalizeComponentName(n));
  };

  const lineRows = rows<{
    id: string;
    variant_id: string | null;
    kind: string | null;
    bundle_selections: unknown;
  }>(
    await db.execute(sql`
      SELECT oi.id::text AS id,
             oi.variant_id::text AS variant_id,
             p.kind::text AS kind,
             oi.bundle_selections AS bundle_selections
        FROM order_items oi
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        LEFT JOIN products p ON p.id = pv.product_id
       WHERE oi.order_id = ${orderId}
    `),
  );

  const emptyBundleIds: string[] = [];
  const compVids = new Set<string>();
  const storedByItem = new Map<string, Array<{ vid: string; name: string | null }>>();

  for (const l of lineRows) {
    // (a) Whole item is a (book)kit → every category-tree leaf is a book.
    if (l.kind === "kit" && l.variant_id && UUID_RE.test(l.variant_id)) {
      const cats = await loadBookkitCategoryTree(l.variant_id, schoolId);
      for (const cat of cats) for (const leaf of cat.items) add(leaf.name);
    }
    const raw = Array.isArray(l.bundle_selections)
      ? (l.bundle_selections as Array<Record<string, unknown>>)
      : [];
    if (raw.length === 0) {
      emptyBundleIds.push(l.id);
      continue;
    }
    const stored: Array<{ vid: string; name: string | null }> = [];
    for (const c of raw) {
      const vid = typeof c.variantId === "string" ? c.variantId : "";
      const nm = typeof c.name === "string" ? c.name : null;
      if (vid && UUID_RE.test(vid)) {
        compVids.add(vid);
        stored.push({ vid, name: nm });
      }
    }
    if (stored.length > 0) storedByItem.set(l.id, stored);
  }

  // (b) Stored components (one batched kind lookup): kit → tree leaves; book → name.
  if (compVids.size > 0) {
    const kindRows = rows<{ id: string; kind: string | null; name: string | null }>(
      await db.execute(sql`
        SELECT pv.id::text AS id, p.kind::text AS kind, p.name AS name
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
         WHERE pv.id IN (${sql.join([...compVids].map((v) => sql`${v}`), sql`, `)})
      `),
    );
    const metaByVid = new Map(kindRows.map((r) => [r.id, r] as const));
    for (const stored of storedByItem.values()) {
      for (const c of stored) {
        const meta = metaByVid.get(c.vid);
        if (!meta) continue;
        if (meta.kind === "kit") {
          const cats = await loadBookkitCategoryTree(c.vid, schoolId);
          for (const cat of cats) for (const leaf of cat.items) add(leaf.name);
        } else if (isBookKind(meta.kind, meta.name ?? c.name)) {
          add(c.name ?? meta.name);
        }
      }
    }
  }

  // (c) Recovered-composition boxes (empty bundle_selections) → fallback books.
  if (emptyBundleIds.length > 0) {
    const fb = await fallbackBundleComponents(emptyBundleIds);
    for (const comps of fb.values())
      for (const c of comps) if (isBookKind(c.kind, c.name)) add(c.name);
  }

  return names;
}

/**
 * Magic-Box UNIFORM / ACCESSORY components that have NOT been delivered yet.
 *
 * A magic box is ONE order_item, but its uniform/accessory components dispatch
 * as separate per-component parcels whose `outward_shipments.item_code` equals
 * the component variant's `sku` EXACTLY (e.g. "SMS HoodiesM30$$"). Books ship
 * in the blank-code bookkit parcel (gated separately by
 * getBookkitParcelDelivered). classifyReturnItems can't see this — every box
 * component inherits the box's order-LEVEL delivered flag — so a component
 * still in transit (e.g. the hoodie on SAL-ORD-2026-14804, delivered box but
 * no hoodie shipment) wrongly looked exchangeable / reportable.
 *
 * Returns the set of component VARIANT IDs (lowercased, as stored in
 * `bundle_selections`) that are pending: a uniform/accessory component whose
 * sku has no `delivered` shipment row, in an order that IS per-component
 * tracked (≥1 component sku present in the shipment mirror — otherwise the box
 * shipped as a single parcel and there's no per-component signal, so we don't
 * gate). Kits / books are never included (they use the bookkit gate). Callers
 * grey these units ("not delivered yet") and reject them on submit.
 *
 * Only covers boxes with STORED bundle_selections; recovered-composition boxes
 * (~66%, empty bundle_selections) have no per-component variant/sku so they
 * can't be matched to a shipment code and keep the order-level behaviour.
 */
export async function getPendingComponentVariantIds(
  orderId: string,
  orderNo: string,
): Promise<Set<string>> {
  const pending = new Set<string>();
  if (!orderNo) return pending;

  const compRows = rows<{
    variant_id: string;
    sku: string;
    kind: string | null;
    name: string | null;
  }>(
    await db.execute(sql`
      SELECT lower(c->>'variantId') AS variant_id,
             lower(cpv.sku)         AS sku,
             cp.kind::text          AS kind,
             coalesce(nullif(c->>'name', ''), cp.name) AS name
        FROM order_items oi
        JOIN product_variants pv ON pv.id = oi.variant_id
        JOIN products p ON p.id = pv.product_id
        CROSS JOIN LATERAL jsonb_array_elements(oi.bundle_selections) c
        JOIN product_variants cpv
          ON cpv.id = CASE WHEN (c->>'variantId') ~ '^[0-9a-f-]{36}$'
                           THEN (c->>'variantId')::uuid END
        JOIN products cp ON cp.id = cpv.product_id
       WHERE oi.order_id = ${orderId}
         AND p.kind IN ('magic_box', 'kit', 'sub_bundle')
         AND jsonb_typeof(oi.bundle_selections) = 'array'
         AND cpv.sku IS NOT NULL AND cpv.sku <> ''
    `),
  );
  if (compRows.length === 0) return pending;

  // Audit's per-line held-back pin, keyed by component sku. Non-null
  // `packing_state` ⇒ the component was NOT handed over (out of stock, still
  // packing), even when a sibling piece under the same base name did ship —
  // which the base-name fallback below would otherwise read as delivered.
  // Magic-box PARENT lines also carry packing_state (a box never dispatches
  // whole), but we only ever match a component's own sku, so the parent's pin
  // cannot leak onto its children.
  const packingRows = rows<{ item_code: string }>(
    await db.execute(sql`
      SELECT DISTINCT lower(i.item_code) AS item_code
        FROM erp.sales_order_items i
        JOIN erp.sales_orders so ON so.erp_name = i.order_erp_name
       WHERE i.order_erp_name = ${orderNo}
         AND i.packing_state IS NOT NULL
         AND i.item_code IS NOT NULL AND i.item_code <> ''
         AND NOT (${SETTLED_CATEGORY_SQL})
    `),
  );
  const packingHeldCodes = new Set(packingRows.map((r) => r.item_code));

  // Pull description too: a magic box's uniform pieces frequently dispatch
  // under a DIFFERENT size-code than the customer ordered (e.g. ordered
  // "SAS KS BeltLM$$$" but shipped "SAS KS BeltLS$$$" — the parcel physically
  // arrived, just recorded at a corrected size). Exact sku↔item_code then
  // misses and the piece falsely reads "not delivered yet" in the picker even
  // though the order page (which matches by base NAME) shows it delivered.
  // Match by base-name as a fallback, mirroring the order-page resolver.
  const shipRows = rows<{ item_code: string; description: string | null; delivered: boolean }>(
    await db.execute(sql`
      SELECT lower(item_code) AS item_code,
             description,
             bool_or(lower(status) = 'delivered') AS delivered
        FROM erp.outward_shipments
       WHERE order_erp_name = ${orderNo}
         AND is_deleted = false
         AND item_code IS NOT NULL AND item_code <> ''
       GROUP BY lower(item_code), description
    `),
  );
  // Audit's per-category delivery floor — the SAME signal the order-page badge
  // applies (see erp-customer-orders.ts: `own !== null` → catDelivered ?
  // "delivered" : "pending"). A magic box's uniform parcel routinely keeps its
  // per-item `outward_shipments` rows at `dispatched` forever: the courier
  // never posts a per-line delivered scan, and audit settles the CATEGORY
  // instead (`derived_delivery_by_category.uniform = "Delivered"`). Without
  // this floor the picker read every one of those pieces as pending while the
  // order page badged them Delivered, and — because the badge-parity pass
  // (2026-07-27) is a UNION that can only hide more — the badge could not
  // rescue them, so the parent could not exchange a single uniform piece
  // (e.g. SAL-ORD-2026-22600: 9 of 11 uniforms blocked).
  const uniformCatRows = rows<{ s: string | null }>(
    await db.execute(sql`
      SELECT raw->'derived_delivery_by_category'->>'uniform' AS s
        FROM erp.sales_orders
       WHERE erp_name = ${orderNo}
       LIMIT 1
    `),
  );
  const uniformCat = (uniformCatRows[0]?.s ?? "").toLowerCase();
  // Coarse-map exactly as coarseCatStatus does: "out for delivery" / "not
  // delivered" are NOT a delivered floor; anything else containing "deliver"
  // ("Delivered", "Delivered · 1 pending" — the held-back pieces are pinned
  // separately by packing_state) is.
  const uniformCatDelivered =
    !!uniformCat &&
    !uniformCat.includes("out for delivery") &&
    !uniformCat.includes("ofd") &&
    !(uniformCat.includes("not") && uniformCat.includes("deliver")) &&
    uniformCat.includes("deliver");

  const allCodes = new Set<string>();
  const deliveredCodes = new Set<string>();
  const allNames = new Set<string>();
  const deliveredNames = new Set<string>();
  for (const r of shipRows) {
    allCodes.add(r.item_code);
    if (r.delivered) deliveredCodes.add(r.item_code);
    const nm = baseName(r.description);
    if (nm) {
      allNames.add(nm);
      if (r.delivered) deliveredNames.add(nm);
    }
  }

  // Per-order trackability: the box must actually dispatch per-component
  // (some component sku OR base-name appears in the mirror). Otherwise it
  // shipped as one parcel and we have no per-component signal → don't gate.
  const tracked = compRows.some(
    (c) => allCodes.has(c.sku) || allNames.has(baseName(c.name)),
  );

  for (const c of compRows) {
    // The packing pin is authoritative on its own and does NOT depend on the
    // order being per-component tracked — a box that ships as one parcel still
    // gets accurate packing_state from audit. It is NOT authoritative once the
    // component's own parcel is recorded delivered, though: `packing_state` is
    // a packing-time snapshot audit never clears when a piece pinned 'oos' is
    // found and shipped anyway (SAL-ORD-2026-34839 on the plain-line side).
    // Same guard as the order-page component badge, so the picker and the
    // badge stay in lockstep.
    const pinDeliveredRow =
      deliveredCodes.has(c.sku) || deliveredNames.has(baseName(c.name));
    if (packingHeldCodes.has(c.sku) && !pinDeliveredRow) {
      pending.add(c.variant_id);
      continue;
    }
    if (!tracked) continue; // one-parcel box, no packing pin → no per-component signal
    if (c.kind !== "uniform" && c.kind !== "accessory") continue; // books/kits → bookkit gate
    const hasRow = allCodes.has(c.sku) || allNames.has(baseName(c.name));
    const deliveredRow =
      deliveredCodes.has(c.sku) || deliveredNames.has(baseName(c.name));
    // Matches the order-page badge: a piece with its OWN shipment row is
    // delivered when that row says so, OR when audit has settled the whole
    // uniform category as delivered (a stale per-line `dispatched` row). A
    // piece with NO row at all in a line-tracked box is genuinely held back
    // (e.g. the Hoodie on …-14804) and stays pending regardless of the floor.
    const delivered = deliveredRow || (hasRow && uniformCatDelivered);
    if (!delivered) pending.add(c.variant_id);
  }
  return pending;
}
