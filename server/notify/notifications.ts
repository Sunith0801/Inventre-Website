import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, parents, returns, schools } from "@/db/schema";
import { sendSms } from "@/server/notify/sms";
import { formatPickupLabel, type ExchangeStatus } from "@/server/exchange";

// "confirmed" intentionally absent: order confirmation sends a real
// DLT-backed SMS + email via lib/order-confirmation.ts, with its own
// idempotency log. Listing it here would re-fire from the admin status
// PATCH with a body that doesn't match any DLT template.
const TEMPLATES: Record<string, (orderNumber: string) => string> = {
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
// Schools whose exchange collection happens at the Inventre store, not the
// school office. For these the SMS copy says "the store" instead of school —
// mirrors the in-app banner (app/shop/orders/[id]/exchange/[returnId]).
const STORE_PICKUP_SCHOOL_CODES = new Set(["KLINK", "QLPHP"]);

const EXCHANGE_TEMPLATES: Record<
  ExchangeStatus,
  (args: {
    returnNumber: string;
    pickupLabel: string | null;
    atStore?: boolean;
  }) => string
> = {
  requested: ({ returnNumber }) =>
    `Inventre: Your exchange request ${returnNumber} has been received. Approval is pending — we'll notify you shortly.`,
  // No pickup date in the copy: the school (or the store team) tells the
  // parent once the exchange physically lands there. Mirrors the in-app
  // banners — see app/shop/orders/[id]/exchange/[returnId].
  approved: ({ returnNumber, atStore }) =>
    atStore
      ? `Inventre: Exchange request ${returnNumber} is approved and on its way to the Inventre Experience Store, Ashoka Mall, Kukatpally. The store team will inform you once it has been received, and you can collect it then.`
      : `Inventre: Exchange request ${returnNumber} is approved and on its way to your school. The school will inform you once it has been received, and you can collect it then.`,
  rejected: ({ returnNumber }) =>
    `Inventre: Exchange request ${returnNumber} could not be approved. Please check the order page for details.`,
  received: ({ returnNumber, atStore }) =>
    atStore
      ? `Inventre: Exchange ${returnNumber} has been handed over at the Inventre Experience Store, Ashoka Mall, Kukatpally. Thank you for shopping with Inventre.`
      : `Inventre: Exchange ${returnNumber} has been handed over at school. Thank you for shopping with Inventre.`,
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
        schoolCode: schools.schoolCode,
      })
      .from(returns)
      .innerJoin(parents, eq(parents.id, returns.parentId))
      .innerJoin(orders, eq(orders.id, returns.orderId))
      .innerJoin(schools, eq(schools.id, orders.schoolId))
      .where(eq(returns.id, returnId))
      .limit(1);
    if (!row || !row.returnNumber) return;

    const addr = row.orderShipping as { receiverPhone?: string } | null;
    const phone = addr?.receiverPhone ?? row.parentPhone;
    if (!phone) return;

    const pickupLabel = row.pickupDate ? formatPickupLabel(row.pickupDate) : null;
    const atStore = STORE_PICKUP_SCHOOL_CODES.has(row.schoolCode ?? "");
    const body = tmpl({ returnNumber: row.returnNumber, pickupLabel, atStore });

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
