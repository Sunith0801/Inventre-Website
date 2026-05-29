import { NextResponse } from "next/server";
import { z } from "zod";
import { sql, and, eq, count } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  websiteCartCoupons,
  websiteCartCouponUsages,
} from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { redis } from "@/lib/redis";

// Forces runtime execution — the GET handler touches Redis (cart coupon
// state) and the build host can't reach the in-container Redis. Without
// this, `next build` tries to pre-collect the route's data and times out.
export const dynamic = "force-dynamic";

const couponKey = (parentId: string) => `coupon:${parentId}`;
const Body = z.object({ code: z.string().min(1) });

/**
 * Apply a Website Cart Coupon (mirrors ERPNext doctype) to the cart.
 * Validates is_active, validity window, school/student scope and one-time/
 * multi-use rules. Discount value is recomputed at cart-read so a code that
 * becomes ineligible mid-session naturally drops out.
 */
export async function POST(req: Request) {
  const me = await getCurrentParent();
  if (!me)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code } = Body.parse(await req.json());

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
  if (!c)
    return NextResponse.json(
      { error: "Invalid or inactive coupon code" },
      { status: 404 },
    );

  const now = new Date();
  if (c.startDatetime && c.startDatetime > now)
    return NextResponse.json(
      { error: "Coupon is not yet active" },
      { status: 400 },
    );
  if (c.endDatetime && c.endDatetime < now)
    return NextResponse.json({ error: "Coupon has expired" }, { status: 400 });

  // Scope: school + student. If coupon is tied to a school, the parent's
  // active student must belong to that school; same for student-tied coupons.
  if (c.schoolId) {
    const ok = me.students.some((s) => s.school.id === c.schoolId);
    if (!ok)
      return NextResponse.json(
        { error: "Coupon is restricted to a different school" },
        { status: 400 },
      );
  }
  // Grade restriction (local-only field, paired with school). Coupon is
  // valid only if the parent has a student in the linked school AND that
  // student's grade matches.
  if (c.grade) {
    const ok = me.students.some(
      (s) =>
        s.grade === c.grade &&
        (!c.schoolId || s.school.id === c.schoolId),
    );
    if (!ok)
      return NextResponse.json(
        { error: `Coupon is restricted to grade ${c.grade}` },
        { status: 400 },
      );
  }
  if (c.studentId) {
    const ok = me.students.some((s) => s.id === c.studentId);
    if (!ok)
      return NextResponse.json(
        { error: "Coupon is restricted to a different student" },
        { status: 400 },
      );
  }

  // One-time-use: any redemption anywhere disqualifies further use.
  if (c.oneTimeUse) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(websiteCartCouponUsages)
      .where(eq(websiteCartCouponUsages.couponId, c.id));
    if (Number(n) >= 1)
      return NextResponse.json(
        { error: "This coupon has already been redeemed" },
        { status: 400 },
      );

    // Reserve-on-placement: if another parent is mid-checkout with this
    // coupon attached to an order whose payment is still pending and the
    // order was placed in the last 30 minutes (the CCAvenue session
    // lifetime), block this application. The reservation expires
    // naturally if the other order fails or stales out.
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
    if (reserved)
      return NextResponse.json(
        { error: "Coupon is reserved for another in-flight checkout. Try again in a few minutes." },
        { status: 400 },
      );
  } else if (!c.canUseMultipleTimes) {
    // Neither flag set → also single-use per customer.
    const [{ n }] = await db
      .select({ n: count() })
      .from(websiteCartCouponUsages)
      .where(
        and(
          eq(websiteCartCouponUsages.couponId, c.id),
          eq(websiteCartCouponUsages.parentId, me.id),
        ),
      );
    if (Number(n) >= 1)
      return NextResponse.json(
        { error: "You have already redeemed this coupon" },
        { status: 400 },
      );
  }

  await redis.set(couponKey(me.id), c.couponCode, "EX", 60 * 60 * 24);
  return NextResponse.json({
    ok: true,
    code: c.couponCode,
    name: c.couponCode,
    discountType: c.discountType,
    discount: Number(c.discount),
    maximumDiscountAmount: c.maximumDiscountAmount,
  });
}

/**
 * Return the coupon currently applied to this cart (if any) so the cart UI
 * can restore the "applied" badge + discount line on page reload. Revalidates
 * the coupon — if it became inactive or expired since being applied, it is
 * dropped from Redis and the caller is told nothing is applied.
 */
export async function GET() {
  const me = await getCurrentParent();
  if (!me)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const code = await redis.get(couponKey(me.id));
  if (!code) return NextResponse.json({ applied: null });

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

  const now = new Date();
  const stillValid =
    c &&
    (!c.startDatetime || c.startDatetime <= now) &&
    (!c.endDatetime || c.endDatetime >= now);

  if (!stillValid) {
    await redis.del(couponKey(me.id));
    return NextResponse.json({ applied: null });
  }

  return NextResponse.json({
    applied: {
      code: c.couponCode,
      name: c.couponCode,
      discountType: c.discountType,
      discount: Number(c.discount),
      maximumDiscountAmount: c.maximumDiscountAmount,
    },
  });
}

export async function DELETE() {
  const me = await getCurrentParent();
  if (!me)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await redis.del(couponKey(me.id));
  return NextResponse.json({ ok: true });
}
