import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, parents } from "@/db/schema";
import { sendSms } from "./sms";

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
