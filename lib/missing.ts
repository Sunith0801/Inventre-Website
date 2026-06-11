import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { missingItemClaims, missingItemClaimItems, orders } from "@/db/schema";
import { allocClaimNumber } from "@/lib/numbering";
import { firstPickupSaturday, toDbDate } from "@/lib/date";
import { findOpenRequestForOrder } from "@/lib/exchange";
import { isExchangeScopeRelaxed } from "@/lib/exchange-gate";

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
  // 1. Scope: order must belong to this parent. Status doesn't have to
  //    be delivered — a customer can claim a missing item the moment
  //    the box arrives (or even before, if they spot a short ship).
  //    But it must NOT be in an obviously-pre-delivery state.
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, input.orderId),
        isExchangeScopeRelaxed() ? undefined : eq(orders.parentId, input.parentId)
      )
    )
    .limit(1);
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  if (order.status === "placed" || order.status === "confirmed") {
    return {
      ok: false,
      status: 400,
      error: "Order hasn't been dispatched yet — wait for delivery before claiming missing items.",
    };
  }

  // 2. Cross-flow per-sale-order block. ONE missing claim + ONE exchange
  //    request per order, lifetime — until either is rejected.
  // Dev: lifetime lock disabled (isExchangeScopeRelaxed) so testers can
  // raise repeat requests on the same order.
  const open = isExchangeScopeRelaxed()
    ? null
    : await findOpenRequestForOrder(input.orderId, input.parentId);
  if (open) {
    const msg =
      open.kind === "missing"
        ? "A missing-item claim for this order is already in progress."
        : "An exchange request is already in progress for this order — please wait for it to close before raising a missing claim.";
    return {
      ok: false,
      status: 409,
      error: msg,
      details: { existingKind: open.kind, existingStatus: open.status },
    };
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
