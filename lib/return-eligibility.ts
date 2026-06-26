import "server-only";
import { getParentOrderDetailFromErp } from "@/lib/erp-customer-orders";

/**
 * Customer-raised exchange / missing-item eligibility — single source of
 * truth shared by the Request-exchange / Report-missing BUTTON gate
 * (app/api/orders/[id]/route.ts), the form pages, and the submit
 * handlers (lib/exchange.ts, lib/missing.ts).
 *
 * An order is eligible when BOTH hold:
 *   1. Delivered — by EITHER the local `orders.status` column OR the
 *      audit/ERP shipment-mirror–derived status
 *      (getParentOrderDetailFromErp().status — the SAME value the order
 *      header shows). The two signals lag each other in BOTH directions
 *      (the local column only advances when an audit→inventre status
 *      webhook lands, which is frequently missed — leaving fully-delivered
 *      orders stuck at packed/shipped; conversely the mirror can briefly
 *      lag a just-delivered local order). OR-ing them keeps every gate in
 *      agreement.
 *   2. Within the RETURNS_WINDOW_DAYS-day window measured from the
 *      delivery date — business rule (2026-06-26): exchange/missing stay
 *      available for 15 days after delivery, then close.
 */

/** Days after delivery that exchange / missing stays available. */
export const RETURNS_WINDOW_DAYS = 15;
const WINDOW_MS = RETURNS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Is `now` still inside the RETURNS_WINDOW_DAYS-day window measured from
 * `deliveredAt`?
 *
 * When the delivery date is UNKNOWN (null) we do NOT block — many
 * genuinely-delivered orders carry no `delivered_at` timestamp at all
 * (audit marks the order delivered at the header / per-category level
 * without ever writing an outward_shipments `delivered_at`, and the local
 * column only lands on a webhook that's often missed). Blocking on a
 * missing date would silently hide the feature from thousands of
 * delivered orders, so unknown → treated as in-window. Once a real
 * delivery date is present the 15-day cutoff is enforced.
 */
export function isWithinReturnsWindow(
  deliveredAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!deliveredAt) return true;
  return now.getTime() - deliveredAt.getTime() <= WINDOW_MS;
}

/**
 * Delivered AND inside the 15-day window. `localDeliveredAt` is the local
 * `orders.delivered_at` column (set when the delivery webhook lands);
 * when absent we fall back to the mirror's shipment `delivered_at`.
 */
export async function isOrderDeliveredForReturns(
  parentId: string,
  orderNumber: string,
  localStatus: string | null,
  localDeliveredAt: Date | null = null
): Promise<boolean> {
  const detail = await getParentOrderDetailFromErp(parentId, orderNumber);
  const delivered =
    localStatus === "delivered" || detail?.status === "delivered";
  if (!delivered) return false;
  // 15-day window. Prefer the local delivered_at, fall back to the mirror
  // shipment delivered_at. Unknown → in-window (see isWithinReturnsWindow).
  const mirrorDeliveredAt = detail?.deliveredAt
    ? new Date(detail.deliveredAt)
    : null;
  return isWithinReturnsWindow(localDeliveredAt ?? mirrorDeliveredAt);
}
