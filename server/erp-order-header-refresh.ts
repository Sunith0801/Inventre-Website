/**
 * Re-pull one Sales Order header from audit into `erp.sales_orders`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `derived_delivery_by_category` — the per-category pill the storefront
 * renders verbatim (see `lib/erp-customer-orders.ts`) — is NOT a stored
 * column on audit. Audit recomputes it at READ time from that order's
 * shipments / packing units (`delivery_rollup._compute_rollup_full`), and
 * we only ever snapshot it into `erp.sales_orders.raw` when the SO row
 * itself is mirrored: an `order.updated` webhook, or the `/api/orders`
 * delta poll keyed on audit's `modified`.
 *
 * A shipment-only change never touches audit's SO row. The clearest case is
 * a Porter drop AT the school, which audit treats as the terminal delivery
 * moment (`partner == 'shipped_to_school'`, or `partner == 'porter'` with
 * `dispatch_destination == 'school'` — it promotes the row to "delivered"
 * inside the rollup, without writing anything back to the shipment or the
 * order). The shipment webhook lands, we mirror the parcel, audit's live
 * pill flips to Delivered — and our snapshot stays frozen at whatever it
 * said before, forever. The parent keeps seeing "pending" over a parcel
 * that reached the school weeks ago, and (because the exchange / missing
 * gate reads the same map) the request buttons stay hidden.
 *
 * Measured on prod 2026-08-10, before this fix: 3,413 orders had at least
 * one category reading not-delivered in our snapshot while audit's live
 * rollup said Delivered. Only 10 drifted the other way — so re-pulling is
 * overwhelmingly a correction, not a downgrade risk.
 *
 * Reported on SAL-ORD-2026-33270 (bookkit re-shipped by Porter to the
 * school on 2026-07-29 after a DTDC RTO; snapshot last written 09:10 that
 * morning, four hours before the drop).
 */
import "server-only";
import { erpAuthedGet } from "@/server/erp-jwt";
import {
  upsertOrderMirror,
  upsertItemsMirror,
  type ErpOrderDetailResp,
} from "@/server/erp-poll";

/**
 * Fetch `/api/orders/{name}` and re-upsert the header (+ item lines) into
 * the mirror. Returns true when the header came back and was written.
 *
 * Never throws — a failed refresh leaves the previous snapshot in place,
 * which is exactly the pre-existing behaviour.
 */
export async function refreshOrderHeaderMirror(
  orderErpName: string,
): Promise<boolean> {
  if (!orderErpName) return false;
  try {
    const detail = await erpAuthedGet<ErpOrderDetailResp>(
      `/api/orders/${encodeURIComponent(orderErpName)}`,
    );
    if (!detail?.header?.name) return false;
    await upsertOrderMirror(detail.header);
    if (Array.isArray(detail.items)) {
      await upsertItemsMirror(detail.header.name, detail.items);
    }
    return true;
  } catch (e) {
    console.warn(
      `[order-header-refresh] ${orderErpName} failed:`,
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
    return false;
  }
}

// ── Lazy, throttled variant used on the customer's order-detail render ──
// In-memory only, per node process — same shape (and same reasoning) as
// `backgroundRefreshShipment` in lib/erp-customer-orders.ts. It exists to
// heal orders whose shipment webhook was dropped or predates this fix; the
// webhook path below is the primary, near-realtime one.
const REFRESH_THROTTLE_MS = 60_000;
const lastHeaderRefresh = new Map<string, number>();

export function backgroundRefreshOrderHeader(orderErpName: string): void {
  if (!orderErpName) return;
  const now = Date.now();
  const last = lastHeaderRefresh.get(orderErpName) ?? 0;
  if (now - last < REFRESH_THROTTLE_MS) return;
  lastHeaderRefresh.set(orderErpName, now);
  // Fire and forget: this render still uses the snapshot we already read.
  // The next one (after the refresh lands) shows audit's current pills.
  void refreshOrderHeaderMirror(orderErpName);
}
