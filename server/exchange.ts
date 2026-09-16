import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  returns,
  returnItems,
  orderItems,
  orders,
  missingItemClaims,
} from "@/db/schema";
import { allocReturnNumber } from "@/server/numbering";
import { firstPickupSaturday, toDbDate } from "@/lib/date";
import { emitExchangeEvent } from "@/server/erp-bridge";
import { notifyExchangeStatus } from "@/server/notify/notifications";
import { isExchangeScopeRelaxed, isExchangeOwnershipRelaxed } from "@/server/exchange-gate";
import { isOrderDeliveredForReturns, getReturnsWindowForOrder } from "@/server/return-eligibility";
import {
  getHeldBackOrderItemIds,
  getLockedComponentSignatures,
  lockStateForSubmittedLine,
  getComposedOrderItemIds,
  getUndeliveredBookComponentNames,
  getPendingComponentVariantIds,
  normalizeComponentName,
} from "@/server/return-line-eligibility";
import { findQtyOverages, formatQtyOverageError } from "@/server/return-qty-cap";
import type { DuplicateOfEntry } from "@/lib/return-duplicates";
import {
  canTransition,
  isExchangeStatus,
  toCancelledReason,
  windowClosedMessage,
  type ExchangeStatus,
} from "@/lib/exchange-shared";

/** Result of the per-sale-order duplicate scan. `source` is where the
 *  blocking request came from — "care_team" means Customer Care raised it
 *  in Audit (Condition 4 wording). */
export interface OpenRequestInfo {
  kind: "exchange" | "missing";
  status: string;
  source: "customer" | "care_team";
}

/**
 * Per-SALE-ORDER duplicate block.
 *
 * Business rule (2026-07-08): only ONE active request may exist per Sales
 * Order — an open Exchange OR an open Missing claim blocks BOTH buttons on
 * that order (Condition 2, "particular sale order" granularity). Rejected
 * requests don't count — the customer is free to retry after a "no" from
 * customer-care (the rejected exception). A request raised by Customer Care
 * in Audit (`source = "care_team"`) blocks the storefront just the same
 * (Condition 4).
 *
 * Scoped to the ORDER, NOT the parent: the caller has already
 * family-authorised the order, and a care-team request synced from Audit
 * carries the order's own `parent_id`, which can differ from the logged-in
 * family member on split / co-guardian accounts. Matching on order id alone
 * guarantees the customer is blocked no matter who raised it.
 *
 * Returns the blocker (so callers can phrase the popup / 409 accurately),
 * or null when the order is clear to file on.
 */
export async function findOpenRequestForOrder(
  orderId: string,
): Promise<OpenRequestInfo | null> {
  const exRows = await db
    .select({ status: returns.status, kind: returns.kind, source: returns.source })
    .from(returns)
    .where(eq(returns.orderId, orderId));
  for (const r of exRows) {
    if (r.kind !== "exchange") continue;
    if (r.status === "rejected") continue;
    return { kind: "exchange", status: r.status, source: normSource(r.source) };
  }
  const mcRows = await db
    .select({ status: missingItemClaims.status, source: missingItemClaims.source })
    .from(missingItemClaims)
    .where(eq(missingItemClaims.orderId, orderId));
  for (const r of mcRows) {
    if (r.status === "rejected") continue;
    return { kind: "missing", status: r.status, source: normSource(r.source) };
  }
  return null;
}

function normSource(s: string | null | undefined): "customer" | "care_team" {
  return s === "care_team" ? "care_team" : "customer";
}

/**
 * Server-side orchestrators for the customer-raised exchange flow.
 *
 * The client-safe slice (types, reason enum, status machine, pickup
 * formatter) lives in `lib/exchange-shared.ts` so it can be imported by
 * client components without dragging `server-only` into the bundle.
 * This file re-exports everything from there, so existing server-side
 * imports of `@/lib/exchange` keep working.
 */

// Re-export the client-safe surface so server code can keep importing
// from "@/server/exchange" without caring about the split.
export {
  DAMAGE_LOCATIONS,
  EXCHANGE_REASONS,
  EXCHANGE_STATUSES,
  PHOTO_CATEGORIES,
  SUB_REASONS,
  canTransition,
  formatPickupLabel,
  isExchangeReason,
  isExchangeStatus,
  isValidSubReason,
  isCancellableRequestStatus,
  isCancelledReason,
  stripCancelledPrefix,
  CANCELLED_REASON_PREFIX,
} from "@/lib/exchange-shared";
export type {
  ExchangePhoto,
  ExchangeReason,
  ExchangeStatus,
} from "@/lib/exchange-shared";

// ─── Pickup-date helper ────────────────────────────────────────────

/**
 * Returns the `YYYY-MM-DD` string that goes into `returns.pickup_date`
 * for an exchange request created now. Centralised here so the API
 * route, the SMS template, and any backfill script share one source of
 * truth.
 */
export function computePickupDate(from: Date = new Date()): string {
  return toDbDate(firstPickupSaturday(from));
}

// ─── Server orchestrators ──────────────────────────────────────────

// Server-side input shape — re-uses the client-safe ExchangePhoto from
// exchange-shared so client + server agree on the photo schema.
import type { ExchangePhoto as SharedExchangePhoto } from "@/lib/exchange-shared";

/**
 * Per-component reason payload. The customer can flag multiple components
 * inside one order_item (e.g. a Magic Box) with different reasons; each
 * lands as its own `return_items` row under one `returns` head.
 */
export interface CreateExchangeItem {
  orderItemId: string;
  qty: number;
  condition: "unopened" | "opened" | "damaged" | null;
  reason: string;
  subReason: string | null;
  damageLocation: string | null;
  replacementMode: string | null;
  requestedVariantId: string | null;
  requestedComponentPath: Record<string, unknown> | null;
  /** Explicit colour/size change for a wrong-colour / wrong-size exchange
   *  (2026-07-09). Persisted inside the return_items `requestedComponentPath`
   *  jsonb so customer-care + audit see original vs requested colour/size. */
  variantChange?: {
    originalColor?: string | null;
    originalSize?: string | null;
    requestedColor?: string | null;
    requestedSize?: string | null;
  } | null;
  notes: string | null;
}

export interface CreateExchangeInput {
  parentId: string;
  orderId: string;
  // Photos are at the request level — they belong to the whole RTN bundle.
  photos: SharedExchangePhoto[];
  // Optional free-form note from the customer (composed by the form from
  // each tab's notes). Lands on the head row.
  notes: string | null;
  // Per-component reasons. At least one required.
  items: CreateExchangeItem[];
}

export type CreateExchangeResult =
  | { ok: true; id: string; returnNumber: string; pickupDate: string }
  | { ok: false; status: number; error: string; details?: unknown };

/**
 * Validate + persist a new customer-raised exchange. Wraps the inserts
 * in a transaction so a half-inserted row (return without return_items)
 * can never persist — that's a bug the existing /api/returns POST had
 * pre-fix.
 *
 * Caller MUST have already established that this parent is in the
 * EXCHANGE_TESTER_PHONES allowlist. This function only validates
 * scope (order belongs to parent, delivered, items present) and writes.
 *
 * The ERP emit and SMS notify run in the background (`void`) so the
 * parent's POST returns promptly even if audit is slow.
 */
export async function createExchange(
  input: CreateExchangeInput
): Promise<CreateExchangeResult> {
  // 1. Scope: order must be delivered AND visible to this parent's family.
  //    Ownership relaxed (all envs) — see isExchangeOwnershipRelaxed; the
  //    family-identity check is enforced by isOrderDeliveredForReturns
  //    below (getParentOrderDetailFromErp returns null for non-family
  //    orders), so dropping the strict parent_id match here is safe and
  //    fixes split-account / guest orders.
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
        "Exchange is only available for delivered orders.",
    };
  }
  // 7-day window from the day the LAST item arrived (2026-09-16). Same
  // computation the button gate + form page use, so a stale open tab that
  // submits after the cut-off is refused here too.
  const window = await getReturnsWindowForOrder(
    input.parentId,
    order.id,
    order.orderNumber,
    order.status,
    order.deliveredAt ?? null,
  );
  if (window?.expired && window.expiresAt) {
    return {
      ok: false,
      status: 400,
      error: windowClosedMessage("exchange", window.expiresAt),
      details: { windowExpiresAt: window.expiresAt.toISOString() },
    };
  }

  // 2. All requested orderItems must exist on this order and have a
  //    non-null variantId (ERP-imported orphans can't be exchanged).
  const ids = input.items.map((i) => i.orderItemId);
  const itemRows = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, input.orderId));
  const onOrder = new Map(itemRows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !onOrder.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      error: "One or more items don't belong to this order",
      details: { missingOrderItemIds: missing },
    };
  }
  const unmapped = ids.filter((id) => onOrder.get(id)!.variantId === null);
  if (unmapped.length > 0) {
    return {
      ok: false,
      status: 400,
      error:
        "Some items are ERP-imported without a local SKU and can't be exchanged. Please contact support.",
      details: { unmappedOrderItemIds: unmapped },
    };
  }

  // 2a-i. WHOLE-BOX guard (server enforcement). A Magic Box / kit can only be
  //     exchanged component-by-component — the storefront picker offers no
  //     whole-box option, so a composed line arriving WITHOUT a
  //     requestedComponentPath is a crafted or stale submission. Reject it
  //     rather than letting it take out every item in the box at once.
  const composed = await getComposedOrderItemIds(input.orderId);
  const wholeBox = input.items.filter(
    (i) => composed.has(i.orderItemId) && !i.requestedComponentPath,
  );
  if (wholeBox.length > 0) {
    return {
      ok: false,
      status: 400,
      error:
        "A Magic Box can only be exchanged item by item — please pick the specific items inside the box that have a problem.",
      details: { wholeBoxOrderItemIds: wholeBox.map((i) => i.orderItemId) },
    };
  }

  // 2a-ii. QUANTITY cap (server enforcement). The picker clamps the Qty box to
  //     the ordered quantity of that line / box component, but an `<input max>`
  //     is advisory — a typed, pasted or hand-crafted value sails past it. Cap
  //     it here against what the order actually contains (line qty for a
  //     standalone item, `bundle_selections` qty for a Magic-Box component).
  //     Components that can't be resolved to an ordered qty are left uncapped
  //     on purpose — see lib/return-qty-cap.ts.
  const overages = await findQtyOverages(
    input.orderId,
    input.items.map((i) => ({
      orderItemId: i.orderItemId,
      qty: i.qty,
      componentPath: i.requestedComponentPath ?? null,
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

  // 2b. Held-back lines (out of stock / still out-for-delivery — not yet
  //     received) can't be exchanged: the customer doesn't have them yet,
  //     we already know, and they ship in a later parcel. Mirrors the
  //     per-item badge on /shop/orders/[id]. Kit / Magic-Box / bundle
  //     parents ship blank-code and are never flagged here.
  const heldBack = await getHeldBackOrderItemIds(input.orderId, order.orderNumber);
  const notArrived = ids.filter((id) => heldBack.has(id));
  if (notArrived.length > 0) {
    return {
      ok: false,
      status: 400,
      error:
        "Some items haven't been delivered yet (they're out of stock or on the way) and can't be exchanged — they'll arrive in a later shipment.",
      details: { notArrivedOrderItemIds: notArrived },
    };
  }

  // 2c. Bookkit-parcel gate (server enforcement). A magic box's books ship in
  //     a separate bookkit parcel that can land AFTER the uniforms — while the
  //     order already reads "delivered". Until that parcel is delivered the
  //     books aren't exchangeable (they're in transit). The storefront greys
  //     them; enforce it here too so a crafted / stale submission can't slip a
  //     not-yet-delivered book through.
  const undeliveredBooks = await getUndeliveredBookComponentNames(
    input.orderId,
    order.orderNumber,
    order.schoolId ?? null,
  );
  if (undeliveredBooks.size > 0) {
    const blocked = input.items.filter((i) => {
      const path = i.requestedComponentPath as { componentName?: unknown } | null;
      const nm =
        path && typeof path.componentName === "string" ? path.componentName : null;
      return nm != null && undeliveredBooks.has(normalizeComponentName(nm));
    });
    if (blocked.length > 0) {
      return {
        ok: false,
        status: 400,
        error:
          "Some of these books haven't been delivered yet — their parcel is still on the way, so they can't be exchanged. They'll be available once it arrives.",
        details: { notArrivedOrderItemIds: blocked.map((i) => i.orderItemId) },
      };
    }
  }

  // 2d. Magic-box UNIFORM/ACCESSORY per-component gate (server enforcement).
  //     A box component dispatches as its own parcel (item_code == variant
  //     sku); one with no delivered shipment (e.g. an in-transit hoodie) is
  //     still pending even though the box reads delivered at order level. The
  //     storefront greys it; enforce it here too.
  const pendingCompVars = await getPendingComponentVariantIds(
    input.orderId,
    order.orderNumber,
  );
  if (pendingCompVars.size > 0) {
    const blocked = input.items.filter((i) => {
      const path = i.requestedComponentPath as { variantId?: unknown } | null;
      const vid = path && typeof path.variantId === "string" ? path.variantId.toLowerCase() : null;
      return vid != null && pendingCompVars.has(vid);
    });
    if (blocked.length > 0) {
      return {
        ok: false,
        status: 400,
        error:
          "Some of these items haven't been delivered yet — they're still on the way, so they can't be exchanged. They'll be available once they arrive.",
        details: { notArrivedOrderItemIds: blocked.map((i) => i.orderItemId) },
      };
    }
  }

  // 3. Per-ITEM guards (item-wise model, 2026-07-08 — replaces the old
  //    per-sale-order lock). A request is now scoped to the items it
  //    selects; other delivered items stay requestable and a later
  //    submission gets its own RTN.
  //    LOCKED: an item already in a non-rejected request (exchange OR
  //    missing) can't be re-requested until that request is rejected.
  //    Dev-relaxed (isExchangeScopeRelaxed) so testers on the prod snapshot
  //    can still file.
  if (!isExchangeScopeRelaxed()) {
    // COMPONENT-level lock (2026-07-09): a Magic Box is one order_item, so the
    // lock must key on the specific component (requestedComponentPath), not the
    // box's order_item id — otherwise exchanging 2 of 5 components would block a
    // follow-up request for the remaining 3. A whole-box / standalone line
    // (no path) is blocked if the box is fully out OR any component is already out.
    const lockByItem = await getLockedComponentSignatures(input.orderId);
    const already = input.items.filter(
      (i) => lockStateForSubmittedLine(lockByItem.get(i.orderItemId), i.requestedComponentPath).locked,
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

  // 4. Allocate the customer-facing RTN- number + compute pickup date.
  const returnNumber = await allocReturnNumber();
  const pickupDate = computePickupDate();

  // 5. Transactional insert (return + return_items together). Head-row
  //    `returns` columns mirror the FIRST item's choices so audit's
  //    list-view queries (which read off the head row) keep working
  //    unchanged. Per-item truth lives on each `return_items` row.
  const primary = input.items[0];
  const ret = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(returns)
      .values({
        orderId: input.orderId,
        parentId: input.parentId,
        returnNumber,
        kind: "exchange",
        pickupDate,
        reason: primary.reason,
        subReason: primary.subReason,
        notes: input.notes,
        status: "requested",
        itemIds: ids,
        photos: input.photos,
        // ⚠️ These parent-level fields are a PRIMARY-ONLY snapshot (the first
        // selected line). A multi-component request (e.g. a Magic Box with 9
        // parts exchanged at once) has DIFFERENT reason / component / variant
        // per line. NEVER read these for per-line display or fulfilment —
        // every line's real subject lives on its own `return_items` row
        // (`requestedComponentPath`, `reason`, `requestedVariantId`, …).
        // Reusing the parent path is exactly what made the customer exchange
        // page label all 9 components as "Bloomers" (fixed 2026-06-30). Kept
        // only as a convenience/back-compat header value.
        requestedVariantId: primary.requestedVariantId,
        requestedComponentPath: primary.requestedComponentPath,
        damageLocation: primary.damageLocation,
        replacementMode: primary.replacementMode,
      })
      .returning();
    await tx.insert(returnItems).values(
      input.items.map((i) => {
        const oi = onOrder.get(i.orderItemId)!;
        // Fold the explicit colour/size change into the requestedComponentPath
        // jsonb (creating the object for standalone items that have no component
        // path) so it persists without a new column.
        const componentPath =
          i.variantChange
            ? { ...(i.requestedComponentPath ?? {}), variantChange: i.variantChange }
            : i.requestedComponentPath;
        return {
          returnId: created.id,
          orderItemId: i.orderItemId,
          variantId: oi.variantId as string,
          qty: i.qty,
          reason: i.reason,
          condition: i.condition,
          subReason: i.subReason,
          damageLocation: i.damageLocation,
          replacementMode: i.replacementMode,
          requestedVariantId: i.requestedVariantId,
          requestedComponentPath: componentPath,
          notes: i.notes,
        };
      })
    );
    return created;
  });

  // 6. Fan out side-effects without blocking the response. Both helpers
  //    are best-effort and swallow their own errors — the durable record
  //    is the `returns` row, and admin can replay the ERP emit if needed.
  void emitExchangeEvent(ret.id, "exchange.requested");
  void notifyExchangeStatus(ret.id, "requested");

  return { ok: true, id: ret.id, returnNumber, pickupDate };
}

export type TransitionResult =
  | { ok: true; from: ExchangeStatus; to: ExchangeStatus }
  | { ok: false; status: number; error: string };

/**
 * Apply an inbound status transition (from the webhook or poller).
 * Monotonic — refuses to move backward. Updates the appropriate
 * timestamp column and best-effort notifies the parent.
 *
 * `rejectionReason` is honoured only when newStatus === "rejected" — it
 * lands in returns.rejection_reason so the customer-facing status page
 * can render the actual reason instead of generic "contact support"
 * text. Audit's exchange_publish includes it in the webhook envelope;
 * older callers that don't pass it just leave the column null.
 *
 * `duplicateOf` is likewise only stored on rejection: when the reason is
 * "this item is already being exchanged on another request", audit names
 * those request(s) here so the status page can point the customer at the
 * existing RTN. Absent/empty → not a duplicate; the column is left as-is.
 */
export async function transitionExchangeStatus(
  returnId: string,
  newStatus: ExchangeStatus,
  rejectionReason: string | null = null,
  duplicateOf: DuplicateOfEntry[] | null = null
): Promise<TransitionResult> {
  const [row] = await db
    .select({
      id: returns.id,
      status: returns.status,
      kind: returns.kind,
    })
    .from(returns)
    .where(eq(returns.id, returnId))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "Return not found" };
  if (row.kind !== "exchange") {
    return { ok: false, status: 400, error: "Not an exchange row" };
  }
  if (!isExchangeStatus(row.status)) {
    return { ok: false, status: 400, error: `Unknown current status: ${row.status}` };
  }
  if (!canTransition(row.status, newStatus)) {
    return {
      ok: false,
      status: 409,
      error: `Illegal transition ${row.status} → ${newStatus}`,
    };
  }

  const patch: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };
  if (newStatus === "approved") patch.approvedAt = new Date();
  if (newStatus === "received") patch.receivedAt = new Date();
  if (newStatus === "rejected" && rejectionReason && rejectionReason.trim()) {
    patch.rejectionReason = rejectionReason.trim();
  }
  if (
    newStatus === "rejected" &&
    Array.isArray(duplicateOf) &&
    duplicateOf.length > 0
  ) {
    patch.duplicateOf = duplicateOf;
  }

  await db.update(returns).set(patch).where(eq(returns.id, returnId));

  void notifyExchangeStatus(returnId, newStatus);

  return { ok: true, from: row.status, to: newStatus };
}

/**
 * Apply a customer/staff CANCELLATION to an exchange.
 *
 * A cancellation lands the request in the existing terminal `rejected`
 * state with a `rejection_reason` that begins with `CANCELLED_REASON_PREFIX`
 * — the status pages read that prefix and label the row "Cancelled" rather
 * than "Rejected" (no new enum value, no migration).
 *
 * This deliberately BYPASSES the monotonic `canTransition` machine, which
 * (correctly, for the normal flow) forbids `approved → rejected`: an
 * approved-but-not-yet-dispatched request is exactly what a customer is
 * allowed to cancel. It is used by BOTH
 *   - the cancel API route (optimistic local write once the ERP accepts), and
 *   - the inbound `exchange.rejected` webhook when the reason is a cancel,
 * so an ERP-initiated cancel of an approved request also lands correctly.
 *
 * Idempotent: a row already `rejected` is a no-op success (the confirmation
 * webhook after our optimistic write, or a duplicate delivery). A `received`
 * (completed) request can no longer be cancelled → 409. Never notifies (the
 * customer initiated it; the misleading "not approved" SMS must not fire).
 *
 * `rawReason` may be the customer's plain text (prefixed here) or an
 * already-prefixed reason from the ERP (left as-is) — `toCancelledReason`
 * handles both.
 */
export async function applyExchangeCancellation(
  returnId: string,
  rawReason: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const [row] = await db
    .select({ status: returns.status, kind: returns.kind })
    .from(returns)
    .where(eq(returns.id, returnId))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: "Return not found" };
  if (row.kind !== "exchange") {
    return { ok: false, status: 400, error: "Not an exchange row" };
  }
  // Idempotent: already rejected/cancelled → nothing to do.
  if (row.status === "rejected") return { ok: true, status: 200 };
  // Completed exchanges can't be cancelled.
  if (row.status === "received") {
    return { ok: false, status: 409, error: "This request can no longer be cancelled." };
  }
  // requested | approved → cancel.
  await db
    .update(returns)
    .set({
      status: "rejected",
      rejectionReason: toCancelledReason(rawReason),
      updatedAt: new Date(),
    })
    .where(eq(returns.id, returnId));
  return { ok: true, status: 200 };
}
