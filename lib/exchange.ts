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
import { allocReturnNumber } from "@/lib/numbering";
import { firstPickupSaturday, toDbDate } from "@/lib/date";
import { emitExchangeEvent } from "@/lib/erp-bridge";
import { notifyExchangeStatus } from "@/lib/notifications";
import { isExchangeScopeRelaxed, isExchangeOwnershipRelaxed } from "@/lib/exchange-gate";
import { isOrderDeliveredForReturns } from "@/lib/return-eligibility";
import { getHeldBackOrderItemIds } from "@/lib/return-line-eligibility";
import {
  alreadyRaisedMessage,
  canTransition,
  isExchangeStatus,
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
// from "@/lib/exchange" without caring about the split.
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
    order.deliveredAt ?? null
  );
  if (!delivered) {
    return {
      ok: false,
      status: 400,
      error:
        "Exchange is only available for delivered orders, within 15 days of delivery.",
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

  // 3. Cross-flow per-sale-order block. ONE exchange + ONE missing per
  //    order, lifetime — until either is rejected. After rejection the
  //    customer can retry.
  // Dev: lifetime lock disabled (isExchangeScopeRelaxed) so testers can
  // raise repeat requests on the same order.
  const open = isExchangeScopeRelaxed()
    ? null
    : await findOpenRequestForOrder(input.orderId);
  if (open) {
    return {
      ok: false,
      status: 409,
      error: alreadyRaisedMessage(open.kind, open.source),
      details: {
        existingKind: open.kind,
        existingStatus: open.status,
        existingSource: open.source,
      },
    };
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
          requestedComponentPath: i.requestedComponentPath,
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
 */
export async function transitionExchangeStatus(
  returnId: string,
  newStatus: ExchangeStatus,
  rejectionReason: string | null = null
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

  await db.update(returns).set(patch).where(eq(returns.id, returnId));

  void notifyExchangeStatus(returnId, newStatus);

  return { ok: true, from: row.status, to: newStatus };
}
