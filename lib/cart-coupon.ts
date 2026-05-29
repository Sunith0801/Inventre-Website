import "server-only";
import { and, eq, count, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  websiteCartCoupons,
  websiteCartCouponUsages,
} from "@/db/schema";
import { redis } from "@/lib/redis";

const couponKey = (parentId: string) => `coupon:${parentId}`;

type CouponRow = typeof websiteCartCoupons.$inferSelect;

export type ResolvedCoupon = {
  coupon: CouponRow;
  /** Rupees off, in paise (matches orders.discount unit). */
  discountPaise: number;
};

/**
 * Read the coupon currently applied to this parent's cart from Redis,
 * re-validate it the same way /api/cart/apply-coupon does, and compute
 * the discount in paise against the supplied subtotal. Returns null if
 * nothing is applied or the coupon is no longer eligible — callers
 * (checkout) should fall back to a no-discount order in that case rather
 * than failing the whole checkout.
 */
export async function resolveAppliedCoupon(
  parent: {
    id: string;
    students: Array<{ id: string; school: { id: string }; grade?: string | null }>;
  },
  subtotalPaise: number,
): Promise<ResolvedCoupon | null> {
  const code = await redis.get(couponKey(parent.id));
  if (!code) return null;

  const [c] = await db
    .select()
    .from(websiteCartCoupons)
    .where(
      and(
        sql`LOWER(${websiteCartCoupons.couponCode}) = LOWER(${code})`,
        eq(websiteCartCoupons.isActive, true),
      ),
    )
    .limit(1);
  if (!c) return null;

  const now = new Date();
  if (c.startDatetime && c.startDatetime > now) return null;
  if (c.endDatetime && c.endDatetime < now) return null;

  if (c.schoolId && !parent.students.some((s) => s.school.id === c.schoolId))
    return null;
  if (
    c.grade &&
    !parent.students.some(
      (s) => s.grade === c.grade && (!c.schoolId || s.school.id === c.schoolId),
    )
  )
    return null;
  if (c.studentId && !parent.students.some((s) => s.id === c.studentId))
    return null;

  if (c.oneTimeUse) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(websiteCartCouponUsages)
      .where(eq(websiteCartCouponUsages.couponId, c.id));
    if (Number(n) >= 1) return null;
    // Reserve-on-placement: drop if another in-flight order has this coupon.
    // Matches the validator in apply-coupon/route.ts.
    const [reserved] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.couponId, c.id),
          eq(orders.paymentStatus, "pending"),
          sql`${orders.placedAt} > NOW() - INTERVAL '30 minutes'`,
        ),
      )
      .limit(1);
    if (reserved) return null;
  } else if (!c.canUseMultipleTimes) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(websiteCartCouponUsages)
      .where(
        and(
          eq(websiteCartCouponUsages.couponId, c.id),
          eq(websiteCartCouponUsages.parentId, parent.id),
        ),
      );
    if (Number(n) >= 1) return null;
  }

  // Discount math mirrors app/shop/cart/page.tsx's client-side preview.
  // Coupon `discount` is rupees for Fixed and percent for Percentage.
  // maximumDiscountAmount is rupees, 0 = uncapped, only meaningful for %.
  const subtotalRupees = Math.round(subtotalPaise / 100);
  let discRupees = 0;
  if (c.discountType === "Fixed") {
    discRupees = Number(c.discount);
  } else {
    discRupees = Math.round((subtotalRupees * Number(c.discount)) / 100);
    if (c.maximumDiscountAmount > 0)
      discRupees = Math.min(discRupees, c.maximumDiscountAmount);
  }
  discRupees = Math.max(0, Math.min(discRupees, subtotalRupees));
  return { coupon: c, discountPaise: discRupees * 100 };
}

export async function clearAppliedCoupon(parentId: string): Promise<void> {
  await redis.del(couponKey(parentId));
}

/**
 * Record a coupon redemption tied to a local order. Called from the
 * payment-success path in lib/ccavenue-finalize.ts, NOT at order
 * placement, so a failed payment leaves the coupon reusable.
 *
 * Pass the snapshot fields (customerName, orderAmountPaise, transactionDate)
 * when available so the admin /admin/discounts/[id] detail page can render
 * a readable redemption row even after the order is deleted or anonymised.
 */
export async function recordCouponUsage(args: {
  couponId: string;
  parentId: string;
  orderId: string;
  amountSavedPaise: number;
  customerName?: string | null;
  orderAmountPaise?: number | null;
  transactionDate?: Date | null;
}): Promise<void> {
  const txnDate = args.transactionDate
    ? args.transactionDate.toISOString().slice(0, 10)
    : null;
  await db.insert(websiteCartCouponUsages).values({
    couponId: args.couponId,
    parentId: args.parentId,
    orderId: args.orderId,
    amountSaved: args.amountSavedPaise,
    customerName: args.customerName ?? null,
    orderAmount: args.orderAmountPaise ?? null,
    transactionDate: txnDate,
  });
}
