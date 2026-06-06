import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { returns, returnItems, orderItems, orders } from "@/db/schema";
import { allocReturnNumber } from "@/lib/numbering";
import { firstPickupSaturday, toDbDate } from "@/lib/date";
import { emitExchangeEvent } from "@/lib/erp-bridge";
import { notifyExchangeStatus } from "@/lib/notifications";
import {
  canTransition,
  isExchangeStatus,
  type ExchangeStatus,
} from "@/lib/exchange-shared";

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
  EXCHANGE_REASONS,
  EXCHANGE_STATUSES,
  canTransition,
  formatPickupLabel,
  isExchangeReason,
  isExchangeStatus,
} from "@/lib/exchange-shared";
export type { ExchangeReason, ExchangeStatus } from "@/lib/exchange-shared";

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

export type ExchangePhoto = { url: string; key: string };

export interface CreateExchangeInput {
  parentId: string;
  orderId: string;
  reason: string;
  notes: string | null;
  photos: ExchangePhoto[];
  items: {
    orderItemId: string;
    qty: number;
    condition: "unopened" | "opened" | "damaged" | null;
  }[];
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
  // 1. Scope: order must belong to this parent and be delivered.
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.parentId, input.parentId)))
    .limit(1);
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  if (order.status !== "delivered") {
    return {
      ok: false,
      status: 400,
      error: "Exchange is only available for delivered orders",
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

  // 3. Block double-submit: parent should only have one *active* exchange
  //    per order at a time. Active = not in a terminal state.
  const existing = await db
    .select({ id: returns.id, status: returns.status, kind: returns.kind })
    .from(returns)
    .where(and(eq(returns.orderId, input.orderId), eq(returns.parentId, input.parentId)));
  const activeKinds: ExchangeStatus[] = ["requested", "approved"];
  const hasActive = existing.some(
    (r) =>
      r.kind === "exchange" && (activeKinds as readonly string[]).includes(r.status)
  );
  if (hasActive) {
    return {
      ok: false,
      status: 409,
      error: "An exchange request for this order is already in progress.",
    };
  }

  // 4. Allocate the customer-facing RTN- number + compute pickup date.
  const returnNumber = await allocReturnNumber();
  const pickupDate = computePickupDate();

  // 5. Transactional insert (return + return_items together).
  const ret = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(returns)
      .values({
        orderId: input.orderId,
        parentId: input.parentId,
        returnNumber,
        kind: "exchange",
        pickupDate,
        reason: input.reason,
        notes: input.notes,
        status: "requested",
        itemIds: ids,
        photos: input.photos,
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
          reason: input.reason,
          condition: i.condition,
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
 */
export async function transitionExchangeStatus(
  returnId: string,
  newStatus: ExchangeStatus
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

  await db.update(returns).set(patch).where(eq(returns.id, returnId));

  void notifyExchangeStatus(returnId, newStatus);

  return { ok: true, from: row.status, to: newStatus };
}
