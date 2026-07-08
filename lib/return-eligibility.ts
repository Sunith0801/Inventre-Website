import "server-only";
import { getParentOrderDetailFromErp } from "@/lib/erp-customer-orders";
import { REQUEST_WINDOW_DAYS } from "@/lib/exchange-shared";

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
 * Business rule (2026-07-08): 10 days from the delivery date. A delivered
 * order stays eligible for exchange / missing for 10 days, then closes and
 * the buttons are shown DISABLED with an "expired" popup (see the order
 * page + `expiredWindowMessage`).
 *
 * 0 (or any value ≤ 0) DISABLES the time window entirely — a delivered
 * order stays eligible indefinitely (the 2026-06-30 → 2026-07-08 state).
 */
export const RETURNS_WINDOW_DAYS = REQUEST_WINDOW_DAYS;
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

/**
 * Delivery-time eligibility, but returns WHY rather than a plain boolean —
 * so the button gate can tell the customer the difference between "this
 * order can't be exchanged at all (not delivered)" and "the 10-day window
 * has closed" (Condition 1: show the button DISABLED with an expired
 * popup). The `derivedDelivered` flag is the header/mirror-derived status
 * the caller already computed (order.status === "delivered"); we OR it with
 * the local column exactly as isOrderDeliveredForReturns does.
 */
export type ReturnsEligibility = "eligible" | "not_delivered" | "expired";

export function classifyReturnsEligibility(
  localStatus: string | null,
  derivedDelivered: boolean,
  deliveredAt: Date | null,
  now: Date = new Date()
): ReturnsEligibility {
  const delivered = localStatus === "delivered" || derivedDelivered;
  if (!delivered) return "not_delivered";
  return isWithinReturnsWindow(deliveredAt, now) ? "eligible" : "expired";
}
