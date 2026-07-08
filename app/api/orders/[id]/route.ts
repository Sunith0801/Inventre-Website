import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { returns, orders, missingItemClaims, schools } from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";
import {
  getParentOrderDetailFromErp,
  getParentOrderDetailLocal,
} from "@/lib/erp-customer-orders";
import { getOrderPlacementInfo } from "@/lib/order-eligibility";
import {
  isExchangeTester,
  isExchangeScopeRelaxed,
  isExchangeOwnershipRelaxed,
} from "@/lib/exchange-gate";
import { isWithinReturnsWindow } from "@/lib/return-eligibility";

// Schools whose exchange collection happens at the Inventre store, not the
// school office. The order-page exchange banner uses this to swap "school"
// wording for "store". Mirrors the status-page + SMS copy.
const STORE_PICKUP_SCHOOL_CODES = new Set(["KLINK", "QLPHP"]);

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

  // Customer-facing placement extras for an abandoned / not-placed checkout:
  //   • paymentStatusRaw — the actual CCAvenue word ("Initiated"/"Aborted"/…)
  //     so the page can show the real status + its meaning.
  //   • canReorder — false when re-ordering is impossible because a
  //     one-per-student Magic Box is already placed for this student (so we
  //     don't dangle a "Place again" button the cart would just reject).
  // Read-only; failures must never break the order page → default to allow.
  try {
    const placement = await getOrderPlacementInfo(decoded);
    (order as { paymentStatusRaw?: string | null }).paymentStatusRaw =
      placement.paymentStatusRaw;
    (order as { canReorder?: boolean }).canReorder = placement.canReorder;
  } catch {
    (order as { canReorder?: boolean }).canReorder = true;
  }

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
        atStore: boolean;
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
      if (
        local.status === "delivered" &&
        apiStatus !== "delivered" &&
        apiStatus !== "cancelled" &&
        apiStatus !== "returned"
      ) {
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
          atStore: STORE_PICKUP_SCHOOL_CODES.has(local.schoolCode ?? ""),
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
      // Delivery gate: the order is "delivered" for exchange/missing
      // purposes if EITHER authoritative signal says so —
      //   • the audit/ERP shipment-mirror–derived status (`order.status`,
      //     computed by uiStatus() from outward_shipments + audit's
      //     category map / display status — the SAME value the header
      //     shows), OR
      //   • the local `orders.status` column.
      // We must OR them, not pick one: the mirror-derived status routinely
      // runs AHEAD of the local column (the column only advances when an
      // audit→inventre status webhook lands, which is frequently missed —
      // ~1,305 fully-delivered orders were stuck at packed/shipped/placed
      // with the buttons hidden because the old gate read local.status
      // alone). Conversely the old code guarded against the mirror briefly
      // lagging a just-delivered local order. OR-ing covers both lags so
      // neither can ever hide the button on a genuinely delivered order,
      // and guarantees the buttons agree with the displayed header status.
      const derivedDelivered =
        (order as { status?: string }).status === "delivered";
      const localDelivered = local.status === "delivered";
      // 15-day window from the delivery date — exchange/missing close 15
      // days after delivery. Prefer the local delivered_at; fall back to
      // the mirror's shipment delivered_at (the SAME date the header
      // timeline shows). Unknown date → in-window (see
      // isWithinReturnsWindow). Keeps the button in lockstep with the form
      // pages + submit handlers, which apply the identical gate.
      const mirrorDeliveredAt = (order as { deliveredAt?: string | null })
        .deliveredAt;
      const deliveredAt =
        local.deliveredAt ?? (mirrorDeliveredAt ? new Date(mirrorDeliveredAt) : null);
      const isDelivered =
        (derivedDelivered || localDelivered) &&
        isWithinReturnsWindow(deliveredAt);
      canExchange = isDelivered && !anyOpen;
      // Missing claims are gated on delivery, identical to exchange —
      // the parent can only report a short ship once the order is marked
      // delivered (no packed/shipped early-report allowance).
      canMissing = isDelivered && !anyOpen;
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
): Promise<{
  id: string;
  status: string;
  deliveredAt: Date | null;
  schoolCode: string | null;
} | null> {
  // Ownership relaxed (all envs): the order was already family-authorized
  // upstream — this route 404s unless getParentOrderDetailFromErp/Local
  // returned it for `me`. So resolving the local row by id/number alone is
  // safe and fixes split-account/guest orders. (drizzle's and() drops the
  // undefined operand.) See isExchangeOwnershipRelaxed.
  const ownerScope = isExchangeOwnershipRelaxed()
    ? undefined
    : eq(orders.parentId, parentId);
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  const cols = {
    id: orders.id,
    status: orders.status,
    deliveredAt: orders.deliveredAt,
    schoolCode: schools.schoolCode,
  };
  const [row] = isUuid
    ? await db
        .select(cols)
        .from(orders)
        .innerJoin(schools, eq(schools.id, orders.schoolId))
        .where(and(eq(orders.id, idOrNumber), ownerScope))
        .limit(1)
    : await db
        .select(cols)
        .from(orders)
        .innerJoin(schools, eq(schools.id, orders.schoolId))
        .where(and(eq(orders.orderNumber, idOrNumber), ownerScope))
        .limit(1);
  return row
    ? {
        id: row.id,
        status: row.status as string,
        deliveredAt: row.deliveredAt,
        schoolCode: row.schoolCode,
      }
    : null;
}
