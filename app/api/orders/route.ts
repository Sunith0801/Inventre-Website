import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { requireParent, isResponse } from "@/server/parent-guard";
import { listParentOrdersFromErp } from "@/server/erp-customer-orders";
import { isExchangeTester } from "@/server/exchange-gate";
import {
  classifyReturnItems,
  computeReturnsWindow,
} from "@/server/return-line-eligibility";

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;
  const list = await listParentOrdersFromErp(me.id);

  // Exchange / Missing request window per order (2026-09-16): 7 days from
  // the day the LAST item arrived. Computed only for orders the listing
  // already calls delivered, and only when the flow is open to this parent,
  // so the list card can print "until <date>" / "closed on <date>" exactly
  // as the order page does. Orders with no local row (mirror-only) have no
  // per-item picture and get no window.
  const windowByOrderNo = new Map<
    string,
    { expiresAt: string | null; expired: boolean }
  >();
  const deliveredNos = list
    .filter((o) => o.status === "delivered")
    .map((o) => o.orderNumber);
  if (deliveredNos.length > 0 && isExchangeTester(me.phone)) {
    const local = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        deliveredAt: orders.deliveredAt,
      })
      .from(orders)
      .where(inArray(orders.orderNumber, deliveredNos));
    await Promise.all(
      local.map(async (o) => {
        try {
          const cls = await classifyReturnItems(
            o.id,
            o.orderNumber,
            true,
            o.deliveredAt ?? null,
          );
          const w = computeReturnsWindow(cls);
          if (w.expiresAt) {
            windowByOrderNo.set(o.orderNumber, {
              expiresAt: w.expiresAt.toISOString(),
              expired: w.expired,
            });
          }
        } catch {
          // A window we can't compute must never break My Orders.
        }
      }),
    );
  }

  const out = list.map((o) => ({
    ...o,
    returnsWindow: windowByOrderNo.get(o.orderNumber) ?? null,
  }));
  return NextResponse.json({ orders: out });
}
