import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

function rows<T>(r: unknown): T[] {
  return r as unknown as T[];
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

  // Per-line shipment rank keyed by item_code (delivered=2, OFD=1, else 0).
  // Blank item_codes = parcel-level dispatch (bookkit / magic box) — ignored.
  const shipRows = rows<{ item_code: string; rank: number }>(
    await db.execute(sql`
      SELECT item_code,
             max(CASE lower(status)
                   WHEN 'delivered'        THEN 2
                   WHEN 'out_for_delivery' THEN 1
                   ELSE 0 END)::int AS rank
        FROM erp.outward_shipments
       WHERE order_erp_name = ${orderNo}
         AND is_deleted = false
         AND item_code IS NOT NULL AND item_code <> ''
       GROUP BY item_code
    `),
  );
  // No per-line tracking → nothing held back; the order-level delivered gate
  // governs (legacy / blank-code-only orders).
  if (shipRows.length === 0) return held;

  const rankByCode = new Map<string, number>();
  for (const r of shipRows) rankByCode.set(r.item_code, r.rank);

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
    const rank = rankByCode.get(l.item_code) ?? 0;
    if (rank < 2) held.add(l.id); // pending OR out-for-delivery → held back
  }
  return held;
}
