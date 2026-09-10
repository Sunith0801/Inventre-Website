import "server-only";
import { eq, sql, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { loyaltyLedger, systemSettings } from "@/db/schema";

/**
 * Loyalty engine.
 *
 * Points are stored as integers in `loyalty_ledger`. Balance = SUM(delta).
 * Earn rate, redemption rate, and max-redemption % per order are configured
 * in `system_settings` keys:
 *
 *   loyalty.earn_paise_per_rupee   default 100  (1 point per ₹1)
 *   loyalty.redeem_paise_per_point default 100  (1 point = ₹1 off)
 *   loyalty.max_redeem_pct         default 20   (max 20% of order subtotal)
 *
 * Set values to "0" to effectively disable.
 */

async function setting(
  key: string,
  fallback: number
): Promise<number> {
  const [s] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  if (!s?.value) return fallback;
  const n = Number(s.value);
  return Number.isFinite(n) ? n : fallback;
}

export async function getBalance(parentId: string): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`COALESCE(SUM(${loyaltyLedger.delta}), 0)::int`,
    })
    .from(loyaltyLedger)
    .where(eq(loyaltyLedger.parentId, parentId));
  return Number(row?.balance ?? 0);
}

export async function getLedger(parentId: string, limit = 50) {
  return db
    .select()
    .from(loyaltyLedger)
    .where(eq(loyaltyLedger.parentId, parentId))
    .orderBy(desc(loyaltyLedger.createdAt))
    .limit(limit);
}

/**
 * Award points for a delivered order. Idempotent on (orderId, reason).
 */
export async function awardForOrder(args: {
  parentId: string;
  orderId: string;
  orderSubtotalPaise: number;
}): Promise<{ awarded: number }> {
  // Already awarded?
  const [exists] = await db
    .select({ id: loyaltyLedger.id })
    .from(loyaltyLedger)
    .where(
      sql`${loyaltyLedger.refId} = ${args.orderId}
        AND ${loyaltyLedger.reason} = 'order_earned'`
    )
    .limit(1);
  if (exists) return { awarded: 0 };

  const earnPerRupee = await setting("loyalty.earn_paise_per_rupee", 100);
  if (earnPerRupee <= 0) return { awarded: 0 };

  // points = subtotal_paise / earn_paise_per_rupee
  // when earn_paise_per_rupee=100, ₹1 → 1 point
  const points = Math.floor(args.orderSubtotalPaise / earnPerRupee);
  if (points <= 0) return { awarded: 0 };

  await db.insert(loyaltyLedger).values({
    parentId: args.parentId,
    delta: points,
    reason: "order_earned",
    refType: "order",
    refId: args.orderId,
  });
  return { awarded: points };
}

/**
 * Compute the maximum points the parent can redeem on this order.
 * Returns { maxPoints, maxDiscountPaise } so the cart can preview.
 */
export async function previewRedeem(
  parentId: string,
  orderSubtotalPaise: number
): Promise<{
  balance: number;
  maxPoints: number;
  maxDiscountPaise: number;
  redeemPaisePerPoint: number;
  enabled: boolean;
}> {
  const balance = await getBalance(parentId);
  const redeemPaisePerPoint = await setting(
    "loyalty.redeem_paise_per_point",
    100
  );
  const maxRedeemPct = await setting("loyalty.max_redeem_pct", 20);
  const enabled = redeemPaisePerPoint > 0 && maxRedeemPct > 0;
  if (!enabled) {
    return {
      balance,
      maxPoints: 0,
      maxDiscountPaise: 0,
      redeemPaisePerPoint,
      enabled: false,
    };
  }
  const capPaise = Math.floor((orderSubtotalPaise * maxRedeemPct) / 100);
  const capPoints = Math.floor(capPaise / redeemPaisePerPoint);
  const maxPoints = Math.min(balance, capPoints);
  return {
    balance,
    maxPoints,
    maxDiscountPaise: maxPoints * redeemPaisePerPoint,
    redeemPaisePerPoint,
    enabled,
  };
}

/**
 * Burn points against an order. Caller must have validated against
 * previewRedeem first. Recorded as a negative delta.
 */
export async function redeem(args: {
  parentId: string;
  orderId: string;
  points: number;
}): Promise<{ discountPaise: number }> {
  if (args.points <= 0) return { discountPaise: 0 };
  const balance = await getBalance(args.parentId);
  if (args.points > balance) {
    throw new Error(`Only ${balance} points available`);
  }
  const redeemPaisePerPoint = await setting(
    "loyalty.redeem_paise_per_point",
    100
  );
  await db.insert(loyaltyLedger).values({
    parentId: args.parentId,
    delta: -args.points,
    reason: "order_redeemed",
    refType: "order",
    refId: args.orderId,
  });
  return { discountPaise: args.points * redeemPaisePerPoint };
}

/** Manual admin adjustment (positive or negative). */
export async function adjust(args: {
  parentId: string;
  delta: number;
  notes: string;
  createdBy: string;
}): Promise<void> {
  await db.insert(loyaltyLedger).values({
    parentId: args.parentId,
    delta: args.delta,
    reason: "manual_adjust",
    notes: args.notes,
    createdBy: args.createdBy,
  });
}
