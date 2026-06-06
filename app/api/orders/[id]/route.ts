import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { returns, orders } from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";
import {
  getParentOrderDetailFromErp,
  getParentOrderDetailLocal,
} from "@/lib/erp-customer-orders";
import { isExchangeTester } from "@/lib/exchange-gate";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const me = await requireParent();
  if (isResponse(me)) return me;
  const decoded = decodeURIComponent(id);
  // ERP mirror is the canonical source once a sync has happened. Fresh
  // shop orders (e.g. just-paid CCAvenue) live only in the local `orders`
  // table until then, so fall back so users can see what they just paid for.
  const order =
    (await getParentOrderDetailFromErp(me.id, decoded)) ??
    (await getParentOrderDetailLocal(me.id, decoded));
  if (!order)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Exchange flow surface (phone-gated). For non-allowlisted parents we
  // return the exact same shape as before — no new fields, zero behaviour
  // change. For testers we add:
  //   • canExchange      — boolean gate the UI honours per delivered item
  //   • activeExchange   — the parent's open exchange for this order (if any),
  //                        so the UI can render a status banner in place of
  //                        the request button.
  let canExchange = false;
  let activeExchange:
    | {
        id: string;
        returnNumber: string | null;
        status: string;
        pickupDate: string | null;
        createdAt: string;
        photos: unknown;
      }
    | null = null;

  if (isExchangeTester(me.phone)) {
    // Need the canonical local row to scope the exchange lookup — the
    // ERP-mirror order may not carry the local UUID, so resolve via the
    // local orders table by id-or-order_number against this parent.
    const localOrder = await resolveLocalOrderId(decoded, me.id);
    if (localOrder) {
      canExchange = (order as { status?: string })?.status === "delivered";
      const [row] = await db
        .select({
          id: returns.id,
          returnNumber: returns.returnNumber,
          status: returns.status,
          pickupDate: returns.pickupDate,
          createdAt: returns.createdAt,
          photos: returns.photos,
          kind: returns.kind,
        })
        .from(returns)
        .where(and(eq(returns.orderId, localOrder), eq(returns.parentId, me.id)))
        .orderBy(desc(returns.createdAt))
        .limit(1);
      if (row && row.kind === "exchange") {
        activeExchange = {
          id: row.id,
          returnNumber: row.returnNumber,
          status: row.status,
          pickupDate: row.pickupDate,
          createdAt: row.createdAt.toISOString(),
          photos: row.photos,
        };
      }
    }
  }

  return NextResponse.json({ order, canExchange, activeExchange });
}

/**
 * Resolve the local `orders.id` for an identifier that might be either
 * a UUID (the local id) or an order_number (the customer-facing
 * ORD-…). Scoped to the parent so a non-owning caller can't probe.
 */
async function resolveLocalOrderId(
  idOrNumber: string,
  parentId: string
): Promise<string | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  if (isUuid) {
    const [row] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, idOrNumber), eq(orders.parentId, parentId)))
      .limit(1);
    return row?.id ?? null;
  }
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.orderNumber, idOrNumber), eq(orders.parentId, parentId)))
    .limit(1);
  return row?.id ?? null;
}
