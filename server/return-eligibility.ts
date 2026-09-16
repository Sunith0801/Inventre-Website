import "server-only";
import { getParentOrderDetailFromErp } from "@/server/erp-customer-orders";
import {
  classifyReturnItems,
  computeReturnsWindow,
  type ReturnsWindow,
} from "@/server/return-line-eligibility";

/**
 * Customer-raised exchange / missing-item eligibility — single source of
 * truth shared by the Request-exchange / Report-missing BUTTON gate
 * (app/api/orders/[id]/route.ts), the form pages, and the submit
 * handlers (lib/exchange.ts, lib/missing.ts).
 *
 * An order is eligible when it is Delivered — by EITHER the local
 * `orders.status` column OR the audit/ERP shipment-mirror–derived status
 * (getParentOrderDetailFromErp().status — the SAME value the order header
 * shows). The two signals lag each other in BOTH directions (the local
 * column only advances when an audit→inventre status webhook lands, which
 * is frequently missed — leaving fully-delivered orders stuck at
 * packed/shipped; conversely the mirror can briefly lag a just-delivered
 * local order). OR-ing them keeps every gate in agreement.
 *
 * Delivery is gated per item; on top of it sits an ORDER-level 7-day
 * window counted from the day the last item arrived — see
 * getReturnsWindowForOrder / computeReturnsWindow (2026-09-16).
 */

/**
 * Is this order delivered (and visible to this parent's family)? The
 * `localDeliveredAt` param is retained for call-site compatibility but no
 * longer affects the result now the time window is gone.
 */
export async function isOrderDeliveredForReturns(
  parentId: string,
  orderNumber: string,
  localStatus: string | null,
  _localDeliveredAt: Date | null = null,
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
  return localStatus === "delivered" || detail.status === "delivered";
}

/**
 * The order's post-delivery request window (7 days from the day its LAST
 * item was delivered) — for the submit handlers, which only hold the local
 * `orders` row. Mirrors exactly what the button gate + form pages compute
 * (order-level delivered = local status OR mirror status; delivery date =
 * local deliveredAt, else the mirror's). Null when the order is not visible
 * to this parent's family.
 */
export async function getReturnsWindowForOrder(
  parentId: string,
  orderId: string,
  orderNumber: string,
  localStatus: string | null,
  localDeliveredAt: Date | null,
): Promise<ReturnsWindow | null> {
  const detail = await getParentOrderDetailFromErp(parentId, orderNumber);
  if (!detail) return null;
  const orderDelivered =
    localStatus === "delivered" || detail.status === "delivered";
  const deliveredAt =
    localDeliveredAt ?? (detail.deliveredAt ? new Date(detail.deliveredAt) : null);
  const cls = await classifyReturnItems(orderId, orderNumber, orderDelivered, deliveredAt);
  return computeReturnsWindow(cls);
}
