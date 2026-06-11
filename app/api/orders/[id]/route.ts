import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { returns, orders, missingItemClaims } from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";
import {
  getParentOrderDetailFromErp,
  getParentOrderDetailLocal,
} from "@/lib/erp-customer-orders";
import { isExchangeTester, isExchangeScopeRelaxed } from "@/lib/exchange-gate";

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
  let canMissing = false;
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
  let activeMissing:
    | {
        id: string;
        claimNumber: string | null;
        status: string;
        pickupDate: string | null;
        createdAt: string;
        photos: unknown;
      }
    | null = null;

  if (isExchangeTester(me.phone)) {
    // Read both the local orders.status (inventre's own delivery-status
    // derivation) and the local row id together. The ERP mirror status
    // can lag the local truth — e.g. audit just marked delivered but
    // the mirror sync hasn't propagated yet — so we gate exchange off
    // the local row, not off the API-shaped `order.status`.
    const local = await resolveLocalOrder(decoded, me.id);
    if (local) {
      // Override the API-shaped status with the local truth when local
      // is strictly more advanced. Keeps the storefront UI in sync with
      // the same status that gates the Exchange button — otherwise the
      // header reads "shipped" while a Request-exchange chip appears
      // underneath, which is confusing. Gated to testers for now per
      // the live-site caution; widen once we trust the override for
      // every parent.
      const apiStatus = (order as { status?: string }).status;
      if (apiStatus === "shipped" && local.status === "delivered") {
        (order as { status?: string }).status = local.status;
      }
      const [exRow] = await db
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
        .where(and(eq(returns.orderId, local.id), eq(returns.parentId, me.id)))
        .orderBy(desc(returns.createdAt))
        .limit(1);
      if (exRow && exRow.kind === "exchange") {
        activeExchange = {
          id: exRow.id,
          returnNumber: exRow.returnNumber,
          status: exRow.status,
          pickupDate: exRow.pickupDate,
          createdAt: exRow.createdAt.toISOString(),
          photos: exRow.photos,
        };
      }
      const [mcRow] = await db
        .select({
          id: missingItemClaims.id,
          claimNumber: missingItemClaims.claimNumber,
          status: missingItemClaims.status,
          pickupDate: missingItemClaims.pickupDate,
          createdAt: missingItemClaims.createdAt,
          photos: missingItemClaims.photos,
        })
        .from(missingItemClaims)
        .where(
          and(
            eq(missingItemClaims.orderId, local.id),
            eq(missingItemClaims.parentId, me.id),
          ),
        )
        .orderBy(desc(missingItemClaims.createdAt))
        .limit(1);
      if (mcRow) {
        activeMissing = {
          id: mcRow.id,
          claimNumber: mcRow.claimNumber,
          status: mcRow.status,
          pickupDate: mcRow.pickupDate,
          createdAt: mcRow.createdAt.toISOString(),
          photos: mcRow.photos,
        };
      }

      // Cross-flow lifetime lock: a parent gets ONE exchange + ONE missing
      // per sale order — but the slot is released if customer-care rejects
      // the request. Once any non-rejected request exists in EITHER flow,
      // both buttons disappear on this order.
      const exBlocking =
        activeExchange !== null && activeExchange.status !== "rejected";
      const mcBlocking =
        activeMissing !== null && activeMissing.status !== "rejected";
      // Dev: the lifetime lock is disabled so testers can re-raise
      // exchange / missing on orders they already used up.
      const anyOpen = !isExchangeScopeRelaxed() && (exBlocking || mcBlocking);
      canExchange = local.status === "delivered" && !anyOpen;
      // Missing claims don't require the local row to be delivered (a
      // parent can spot a short ship the moment the box arrives) — but
      // we still gate it on "not still in pre-delivery state".
      const preDelivery =
        local.status === "placed" || local.status === "confirmed";
      canMissing = !preDelivery && !anyOpen;
    }
  }

  return NextResponse.json({
    order,
    canExchange,
    canMissing,
    activeExchange,
    activeMissing,
  });
}

/**
 * Resolve the local `orders` row (id + status) for an identifier that
 * may be either a UUID (the local id) or an order_number (the
 * customer-facing ORD-…). Scoped to the parent so a non-owning caller
 * can't probe.
 */
async function resolveLocalOrder(
  idOrNumber: string,
  parentId: string
): Promise<{ id: string; status: string } | null> {
  // Dev: ownership scope relaxed so testers get the buttons on any
  // delivered order (drizzle's and() drops the undefined operand).
  const ownerScope = isExchangeScopeRelaxed()
    ? undefined
    : eq(orders.parentId, parentId);
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  if (isUuid) {
    const [row] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.id, idOrNumber), ownerScope))
      .limit(1);
    return row ? { id: row.id, status: row.status as string } : null;
  }
  const [row] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(eq(orders.orderNumber, idOrNumber), ownerScope))
    .limit(1);
  return row ? { id: row.id, status: row.status as string } : null;
}
