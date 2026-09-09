import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { missingItemClaims, missingItemClaimItems, orders, orderItems } from "@/db/schema";
import { allocClaimNumber } from "@/lib/numbering";
import { firstPickupSaturday, toDbDate } from "@/lib/date";
import { isExchangeScopeRelaxed, isExchangeOwnershipRelaxed } from "@/lib/exchange-gate";
import { isOrderDeliveredForReturns } from "@/lib/return-eligibility";
import {
  getHeldBackOrderItemIds,
  getLockedComponentSignatures,
  lockStateForSubmittedLine,
  getComposedOrderItemIds,
  getUndeliveredBookComponentNames,
  getPendingComponentVariantIds,
  normalizeComponentName,
} from "@/lib/return-line-eligibility";
import { findQtyOverages, formatQtyOverageError } from "@/lib/return-qty-cap";
import { toCancelledReason } from "@/lib/exchange-shared";

/**
 * Customer-raised "missing-item" claim service.
 *
 * Different from the exchange flow: the customer never received the item,
 * so there's NO reverse logistics. Status machine is also simpler:
 *
 *   requested → approved → received_at_school → delivered
 *   requested → rejected (terminal)
 *
 * Caller MUST have already verified the parent's allowlist + scope.
 */

export type MissingItemClaimStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "received_at_school"
  | "delivered";

export interface MissingClaimItemInput {
  orderItemId: string;
  qtyShort: number;
  // For kit / Magic-Box claims where only a component is missing.
  missingComponentPath?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface CreateMissingClaimInput {
  parentId: string;
  orderId: string;
  notes?: string | null;
  photos: Array<{ url: string; key: string; category?: string; caption?: string }>;
  items: MissingClaimItemInput[];
}

export type CreateMissingClaimResult =
  | { ok: true; id: string; claimNumber: string; pickupDate: string }
  | { ok: false; status: number; error: string; details?: unknown };

const computePickupDate = (): string => toDbDate(firstPickupSaturday(new Date()));

export async function createMissingClaim(
  input: CreateMissingClaimInput,
): Promise<CreateMissingClaimResult> {
  // 1. Scope: order must belong to this parent and be delivered —
  //    identical gate to exchange. A missing-item claim can only be
  //    raised once the order is marked delivered.
  // Ownership relaxed (all envs) — see isExchangeOwnershipRelaxed; family
  // membership is enforced by isOrderDeliveredForReturns below, so dropping
  // the strict parent_id match is safe and fixes split-account orders.
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, input.orderId),
        isExchangeOwnershipRelaxed() ? undefined : eq(orders.parentId, input.parentId)
      )
    )
    .limit(1);
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  // Delivered gate matches the button + form page: local status OR the
  // audit/ERP shipment-mirror-derived status. See isOrderDeliveredForReturns.
  // There is no time window — a delivered item is eligible forever.
  const delivered = await isOrderDeliveredForReturns(
    input.parentId,
    order.orderNumber,
    order.status,
    order.deliveredAt ?? null,
  );
  if (!delivered) {
    return {
      ok: false,
      status: 400,
      error:
        "Missing-item claims are only available for delivered orders.",
    };
  }

  // 1b. Every claimed line must belong to this order (parity with the
  //     exchange flow), and held-back lines (out of stock / still
  //     out-for-delivery — not yet received) can't be reported missing:
  //     we already know they didn't arrive and will ship them later, so
  //     it isn't "missing", it's pending. Mirrors the per-item badge on
  //     /shop/orders/[id]. Kit / Magic-Box / bundle parents ship blank-code
  //     and are never flagged held-back.
  const claimedIds = Array.from(new Set(input.items.map((i) => i.orderItemId)));
  if (claimedIds.length > 0) {
    const onOrder = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, input.orderId), inArray(orderItems.id, claimedIds)));
    const onOrderSet = new Set(onOrder.map((r) => r.id));
    const notOnOrder = claimedIds.filter((id) => !onOrderSet.has(id));
    if (notOnOrder.length > 0) {
      return {
        ok: false,
        status: 400,
        error: "One or more items don't belong to this order",
        details: { missingOrderItemIds: notOnOrder },
      };
    }
  }
  // 1b-i. WHOLE-BOX guard (server enforcement, mirror of createExchange). A
  //     Magic Box / kit can only be reported missing component-by-component —
  //     the picker offers no whole-box option, so a composed line arriving
  //     WITHOUT a missingComponentPath is a crafted or stale submission.
  const composed = await getComposedOrderItemIds(input.orderId);
  const wholeBox = input.items.filter(
    (i) => composed.has(i.orderItemId) && !i.missingComponentPath,
  );
  if (wholeBox.length > 0) {
    return {
      ok: false,
      status: 400,
      error:
        "A Magic Box can only be reported item by item — please pick the specific items inside the box that didn't arrive.",
      details: { wholeBoxOrderItemIds: wholeBox.map((i) => i.orderItemId) },
    };
  }

  // 1b-ii. QUANTITY cap (server enforcement, mirror of createExchange). You
  //     can't be short more units than you ordered. The picker clamps the Qty
  //     box, but that cap is advisory — enforce the real ceiling here from the
  //     order's own lines + Magic-Box components. Unresolvable components stay
  //     uncapped by design (see lib/return-qty-cap.ts).
  const overages = await findQtyOverages(
    input.orderId,
    input.items.map((i) => ({
      orderItemId: i.orderItemId,
      qty: i.qtyShort,
      componentPath: i.missingComponentPath ?? null,
    })),
  );
  if (overages.length > 0) {
    return {
      ok: false,
      status: 400,
      error: formatQtyOverageError(overages),
      details: { qtyOverages: overages },
    };
  }

  const heldBack = await getHeldBackOrderItemIds(input.orderId, order.orderNumber);
  const notArrived = claimedIds.filter((id) => heldBack.has(id));
  if (notArrived.length > 0) {
    return {
      ok: false,
      status: 400,
      error:
        "Some of these items haven't been delivered yet (they're out of stock or on the way) — they'll arrive in a later shipment, so there's nothing to report as missing.",
      details: { notArrivedOrderItemIds: notArrived },
    };
  }

  // 1c. Bookkit-parcel gate (server enforcement, mirror of createExchange).
  //     Until the books' bookkit parcel is delivered they aren't "missing" —
  //     they're still on the way. The storefront greys them; enforce it here
  //     so a crafted / stale submission can't report an in-transit book missing.
  const undeliveredBooks = await getUndeliveredBookComponentNames(
    input.orderId,
    order.orderNumber,
    order.schoolId ?? null,
  );
  if (undeliveredBooks.size > 0) {
    const blocked = input.items.filter((i) => {
      const path = i.missingComponentPath as { componentName?: unknown } | null;
      const nm =
        path && typeof path.componentName === "string" ? path.componentName : null;
      return nm != null && undeliveredBooks.has(normalizeComponentName(nm));
    });
    if (blocked.length > 0) {
      return {
        ok: false,
        status: 400,
        error:
          "Some of these books haven't been delivered yet — their parcel is still on the way, so there's nothing to report as missing. They'll be available once it arrives.",
        details: { notArrivedOrderItemIds: blocked.map((i) => i.orderItemId) },
      };
    }
  }

  // 1d. Magic-box UNIFORM/ACCESSORY per-component gate (server enforcement,
  //     mirror of createExchange). A uniform component with no delivered
  //     shipment (item_code == variant sku) is still on the way — it can't be
  //     "missing" yet. The storefront greys it; enforce it here too.
  const pendingCompVars = await getPendingComponentVariantIds(
    input.orderId,
    order.orderNumber,
  );
  if (pendingCompVars.size > 0) {
    const blocked = input.items.filter((i) => {
      const path = i.missingComponentPath as { variantId?: unknown } | null;
      const vid = path && typeof path.variantId === "string" ? path.variantId.toLowerCase() : null;
      return vid != null && pendingCompVars.has(vid);
    });
    if (blocked.length > 0) {
      return {
        ok: false,
        status: 400,
        error:
          "Some of these items haven't been delivered yet — they're still on the way, so there's nothing to report as missing. They'll be available once they arrive.",
        details: { notArrivedOrderItemIds: blocked.map((i) => i.orderItemId) },
      };
    }
  }

  // 2. Per-ITEM guards (item-wise model, 2026-07-08 — replaces the old
  //    per-sale-order lock). LOCKED: item already in a non-rejected request
  //    (exchange OR missing) → blocked until that request is rejected.
  //    Dev-relaxed so testers on the prod snapshot can still file. (There is
  //    no time window — a delivered item is eligible forever.)
  if (!isExchangeScopeRelaxed()) {
    // COMPONENT-level lock (2026-07-09) — mirror of createExchange. Keys on the
    // specific component (missingComponentPath) so a Magic Box stays reportable
    // for its remaining items after some were already claimed.
    const lockByItem = await getLockedComponentSignatures(input.orderId);
    const already = input.items.filter(
      (i) => lockStateForSubmittedLine(lockByItem.get(i.orderItemId), i.missingComponentPath).locked,
    );
    if (already.length > 0) {
      return {
        ok: false,
        status: 409,
        error:
          "Some of these items already have an open Exchange or Missing request. They become available again only if that request is rejected.",
        details: { lockedOrderItemIds: already.map((i) => i.orderItemId) },
      };
    }
  }

  // 3. Allocate the customer-facing MIS- number + Saturday pickup date.
  const claimNumber = await allocClaimNumber();
  const pickupDate = computePickupDate();

  // 4. Transactional insert (claim + lines together).
  const created = await db.transaction(async (tx) => {
    const [head] = await tx
      .insert(missingItemClaims)
      .values({
        orderId: input.orderId,
        parentId: input.parentId,
        claimNumber,
        status: "requested",
        notes: input.notes ?? null,
        photos: input.photos,
        pickupDate,
      })
      .returning();

    if (input.items.length > 0) {
      await tx.insert(missingItemClaimItems).values(
        input.items.map((it) => ({
          claimId: head.id,
          orderItemId: it.orderItemId,
          qtyShort: it.qtyShort,
          missingComponentPath: it.missingComponentPath ?? null,
          notes: it.notes ?? null,
        })),
      );
    }
    return head;
  });

  // 5. Fire the bridge in the background — parent's POST returns
  //    promptly even if audit is slow.
  void (async () => {
    try {
      const mod = await import("@/lib/erp-bridge");
      await mod.emitMissingClaimEvent(created.id, "missing.requested");
    } catch (e) {
      console.error("[missing] bridge emit failed", e);
    }
  })();

  return {
    ok: true,
    id: created.id,
    claimNumber,
    pickupDate,
  };
}

export function isMissingClaimStatus(v: unknown): v is MissingItemClaimStatus {
  return (
    typeof v === "string" &&
    ["requested", "approved", "rejected", "received_at_school", "delivered"].includes(v)
  );
}

/**
 * Apply a customer/staff CANCELLATION to a missing-item claim.
 *
 * Mirror of `applyExchangeCancellation` (see lib/exchange.ts for the full
 * rationale): lands the claim in the existing terminal `rejected` state with
 * a `rejection_reason` beginning `CANCELLED_REASON_PREFIX`, which the status
 * page renders as "Cancelled". No new enum value, no migration.
 *
 * Cancellable only while the replacement hasn't been dispatched — i.e. from
 * `requested` or `approved`. `received_at_school` / `delivered` are too late
 * (409). `rejected` is an idempotent no-op (confirmation webhook / duplicate).
 */
export async function applyMissingCancellation(
  claimId: string,
  rawReason: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const [row] = await db
    .select({ status: missingItemClaims.status })
    .from(missingItemClaims)
    .where(eq(missingItemClaims.id, claimId))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "Claim not found" };
  if (row.status === "rejected") return { ok: true, status: 200 };
  if (row.status === "received_at_school" || row.status === "delivered") {
    return { ok: false, status: 409, error: "This request can no longer be cancelled." };
  }
  await db
    .update(missingItemClaims)
    .set({
      status: "rejected",
      rejectionReason: toCancelledReason(rawReason),
      rejectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(missingItemClaims.id, claimId));
  return { ok: true, status: 200 };
}
