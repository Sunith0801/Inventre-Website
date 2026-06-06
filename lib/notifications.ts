import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, parents, returns } from "@/db/schema";
import { sendSms } from "./sms";
import { formatPickupLabel, type ExchangeStatus } from "./exchange";

const TEMPLATES: Record<string, (orderNumber: string) => string> = {
  confirmed: (n) =>
    `Inventre: Order ${n} is confirmed. We'll pack it shortly. Track at inventre.in/shop/orders.`,
  packed: (n) =>
    `Inventre: Order ${n} is packed and ready for shipment.`,
  shipped: (n) =>
    `Inventre: Order ${n} has shipped. Tracking details on your order page.`,
  delivered: (n) =>
    `Inventre: Order ${n} has been delivered. Free 14-day returns if anything's not right.`,
  cancelled: (n) =>
    `Inventre: Order ${n} has been cancelled. Refund (if applicable) will reflect in 5-7 days.`,
};

/**
 * SMS bodies for the customer-raised exchange flow. Bodies are written
 * to match the DLT templates we'll register before flipping the feature
 * past the tester phone. Until those DLT IDs are filed, lib/sms.ts's
 * `sendSms` no-ops for non-OTP messages — so customer sees the in-app
 * status banner only, and ops sees a console log line in dev. This is
 * intentional: the function call sites are correct, only the carrier
 * delivery is gated on DLT registration.
 */
const EXCHANGE_TEMPLATES: Record<
  ExchangeStatus,
  (args: { returnNumber: string; pickupLabel: string | null }) => string
> = {
  requested: ({ returnNumber }) =>
    `Inventre: Your exchange request ${returnNumber} has been received. Approval is pending — we'll notify you shortly.`,
  approved: ({ returnNumber, pickupLabel }) =>
    `Inventre: Exchange request ${returnNumber} is approved. Please visit your school on ${pickupLabel ?? "the scheduled Saturday"} to collect the exchange.`,
  rejected: ({ returnNumber }) =>
    `Inventre: Exchange request ${returnNumber} could not be approved. Please check the order page for details.`,
  received: ({ returnNumber }) =>
    `Inventre: Exchange ${returnNumber} has been handed over at school. Thank you for shopping with Inventre.`,
};

/**
 * Send a transactional SMS for the given order's status. Best-effort —
 * failures are logged but don't break the API call that triggered the send.
 */
export async function notifyOrderStatus(orderId: string, status: string) {
  const template = TEMPLATES[status];
  if (!template) return;

  try {
    const [row] = await db
      .select({
        orderNumber: orders.orderNumber,
        phone: parents.phone,
        addr: orders.shippingAddress,
      })
      .from(orders)
      .innerJoin(parents, eq(parents.id, orders.parentId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) return;

    // Prefer the address phone (receiver) if it differs from parent phone
    const addr = row.addr as { receiverPhone?: string } | null;
    const phone = addr?.receiverPhone ?? row.phone;

    await sendSms({
      phone,
      body: template(row.orderNumber),
      variables: { order: row.orderNumber, status },
    });
  } catch (e) {
    console.error("notifyOrderStatus failed:", e);
  }
}

/**
 * Notify the parent about an exchange-request status transition.
 * Best-effort — never throws to the caller. Falls back silently when
 * SMS isn't configured (lib/sms.ts shim) so the status-flip API path
 * doesn't break on a missing DLT template.
 */
export async function notifyExchangeStatus(
  returnId: string,
  status: ExchangeStatus
): Promise<void> {
  const tmpl = EXCHANGE_TEMPLATES[status];
  if (!tmpl) return;
  try {
    const [row] = await db
      .select({
        returnNumber: returns.returnNumber,
        pickupDate: returns.pickupDate,
        parentPhone: parents.phone,
        orderShipping: orders.shippingAddress,
      })
      .from(returns)
      .innerJoin(parents, eq(parents.id, returns.parentId))
      .innerJoin(orders, eq(orders.id, returns.orderId))
      .where(eq(returns.id, returnId))
      .limit(1);
    if (!row || !row.returnNumber) return;

    const addr = row.orderShipping as { receiverPhone?: string } | null;
    const phone = addr?.receiverPhone ?? row.parentPhone;
    if (!phone) return;

    const pickupLabel = row.pickupDate ? formatPickupLabel(row.pickupDate) : null;
    const body = tmpl({ returnNumber: row.returnNumber, pickupLabel });

    await sendSms({
      phone,
      body,
      variables: {
        exchange: row.returnNumber,
        status,
        pickup: pickupLabel ?? "",
      },
    });
  } catch (e) {
    console.error("notifyExchangeStatus failed:", e);
  }
}
