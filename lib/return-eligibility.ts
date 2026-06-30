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

/**
 * Days after delivery that exchange / missing stays available.
 *
 * 0 (or any value ≤ 0) DISABLES the time window entirely — a delivered
 * order stays eligible for exchange / missing indefinitely. Set to a
 * positive number to re-enable the cutoff (e.g. 15 restores the old
 * 15-day rule). Disabled 2026-06-30 per the business: ~79% of delivered
 * orders were past 15 days and the buttons were hidden on them, so the
 * window was removed so every delivered order shows the buttons.
 */
export const RETURNS_WINDOW_DAYS = 0;
const WINDOW_MS = RETURNS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Is `now` still inside the returns window measured from `deliveredAt`?
 *
 * When the window is disabled (RETURNS_WINDOW_DAYS ≤ 0) this is always
 * true — delivery alone makes the order eligible. When a positive window
 * is configured: an UNKNOWN delivery date (null) does NOT block (many
 * delivered orders carry no `delivered_at`), and a known date is checked
 * against the cutoff.
 */
export function isWithinReturnsWindow(
  deliveredAt: Date | null,
  now: Date = new Date()
): boolean {
  if (RETURNS_WINDOW_DAYS <= 0) return true; // window disabled → always eligible
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
  // OWNERSHIP / FAMILY AUTHORIZATION. getParentOrderDetailFromErp applies
  // the SAME family-identity scope as My-Orders (phones, enrollment,
  // customer_link, co-guardian parent ids), so a null result means this
  // order is NOT visible to this parent's family. This is the security
  // boundary that lets the callers drop the strict `orders.parent_id`
  // match (which broke split-account / guest orders): we no longer trust
  // the local `localStatus` on its own — it's only honoured once family
  // access is proven here. Without this guard, relaxing parent_id would
  // let a parent act on any delivered order id.
  if (!detail) return false;
  const delivered =
    localStatus === "delivered" || detail.status === "delivered";
  if (!delivered) return false;
  // 15-day window. Prefer the local delivered_at, fall back to the mirror
  // shipment delivered_at. Unknown → in-window (see isWithinReturnsWindow).
  const mirrorDeliveredAt = detail?.deliveredAt
    ? new Date(detail.deliveredAt)
    : null;
  return isWithinReturnsWindow(localDeliveredAt ?? mirrorDeliveredAt);
}
