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
import { classifyReturnsEligibility } from "@/lib/return-eligibility";
import {
  alreadyRaisedMessage,
  expiredWindowMessage,
} from "@/lib/exchange-shared";

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
  // When a button is NOT enabled we tell the UI WHY, so it can show the
  // button DISABLED with the right popup instead of hiding it (Conditions
  // 1, 2 & 4). `reason` is "expired" (10-day window closed) or "duplicate"
  // (a request already exists for this Sales Order); `message` is the exact
  // copy to show. null → nothing to show (order not delivered, or the
  // button is enabled).
  type RequestBlock = { reason: "expired" | "duplicate"; message: string };
  let exchangeBlock: RequestBlock | null = null;
  let missingBlock: RequestBlock | null = null;

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
      // Latest request per SALE ORDER (NOT scoped to me.id): a request
      // raised by Customer Care in Audit carries the order's own parent_id,
      // which can differ from the logged-in family member on split /
      // co-guardian accounts. Reading by order id means the customer SEES
      // the existing request (banner) and is BLOCKED by it no matter who
      // raised it (Condition 4). `source` distinguishes customer vs
      // care-team for the popup wording.
      const [exRow] = await db
        .select({
          id: returns.id,
          returnNumber: returns.returnNumber,
          status: returns.status,
          pickupDate: returns.pickupDate,
          createdAt: returns.createdAt,
          photos: returns.photos,
          kind: returns.kind,
          source: returns.source,
        })
        .from(returns)
        .where(and(eq(returns.orderId, local.id), eq(returns.kind, "exchange")))
        .orderBy(desc(returns.createdAt))
        .limit(1);
      if (exRow) {
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
          source: missingItemClaims.source,
        })
        .from(missingItemClaims)
        .where(eq(missingItemClaims.orderId, local.id))
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

      // Per-SALE-ORDER duplicate lock: ONE active request (Exchange OR
      // Missing) per order blocks BOTH buttons — released only if it was
      // rejected (the rejected exception). Dev disables the lock so testers
      // can re-raise (isExchangeScopeRelaxed). The blocking request drives
      // the "already raised…" popup, incl. the care-team wording.
      const exBlocking = exRow != null && exRow.status !== "rejected";
      const mcBlocking = mcRow != null && mcRow.status !== "rejected";
      const openReq: { kind: "exchange" | "missing"; source: "customer" | "care_team" } | null =
        isExchangeScopeRelaxed()
          ? null
          : exBlocking
            ? { kind: "exchange", source: exRow.source === "care_team" ? "care_team" : "customer" }
            : mcBlocking
              ? { kind: "missing", source: mcRow.source === "care_team" ? "care_team" : "customer" }
              : null;

      // Delivery + window classification. Delivered when EITHER signal says
      // so — the audit/ERP mirror-derived status (`order.status`, the value
      // the header shows) OR the local `orders.status` column (the two lag
      // each other in both directions, so OR-ing keeps the button in
      // agreement with the header). "expired" = delivered but past the
      // 10-day window; "not_delivered" = not eligible at all.
      const derivedDelivered =
        (order as { status?: string }).status === "delivered";
      const mirrorDeliveredAt = (order as { deliveredAt?: string | null })
        .deliveredAt;
      const deliveredAt =
        local.deliveredAt ?? (mirrorDeliveredAt ? new Date(mirrorDeliveredAt) : null);
      const eligibility = classifyReturnsEligibility(
        local.status,
        derivedDelivered,
        deliveredAt,
      );

      // Buttons enabled only when delivered, in-window, and no open request.
      const enabled = eligibility === "eligible" && !openReq;
      canExchange = enabled;
      canMissing = enabled;

      // Block reasons — only for a DELIVERED order (we never surface the
      // buttons at all on an undelivered order). A duplicate takes
      // precedence over an expired window (an active request is the more
      // relevant thing to tell the customer). The expired copy is per-kind.
      if (eligibility !== "not_delivered") {
        const dupExchange = openReq
          ? { reason: "duplicate" as const, message: alreadyRaisedMessage(openReq.kind, openReq.source) }
          : null;
        exchangeBlock =
          dupExchange ??
          (eligibility === "expired"
            ? { reason: "expired", message: expiredWindowMessage("exchange") }
            : null);
        missingBlock =
          dupExchange ??
          (eligibility === "expired"
            ? { reason: "expired", message: expiredWindowMessage("missing") }
            : null);
      }
    }
  }

  return NextResponse.json({
    order,
    canExchange,
    canMissing,
    exchangeBlock,
    missingBlock,
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
