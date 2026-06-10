import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { failJson } from "@/lib/observability/fail-json";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { orders, orderItems, payments } from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { readCart, clearCart, type CartLine } from "@/lib/repos/cart";
import { generateOrderNumber } from "@/lib/repos/orders";
import { buildRedirectPayload, isCCAvenueConfigured } from "@/lib/ccavenue";
import { financialYearOf } from "@/lib/invoice-numbering";
import { placeOfSupply } from "@/lib/tax";
import { getDefaultWarehouseId } from "@/lib/repos/inventory";
import {
  resolveAppliedCoupon,
  clearAppliedCoupon,
} from "@/lib/cart-coupon";
import { enqueueOrderEvent } from "@/lib/erp-bridge";

/**
 * Sibling of /api/checkout/create-order, but routes through CCAvenue.
 * Returns the form payload the frontend must POST to CCAvenue's hosted page.
 */

const Address = z.object({
  receiverName: z.string().min(1),
  receiverPhone: z.string().regex(/^\d{10}$/),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(/^\d{6}$/),
});

const Body = z.object({
  address: Address,
});

export async function POST(req: Request) {
  // CCAvenue config is only required for non-zero baskets — zero-value
  // baskets short-circuit to a "complimentary" payment further down and
  // never touch the gateway, so blocking unconfigured envs up-front would
  // also block legitimate ₹0 orders (e.g. complimentary kits on dev).

  // Read the parent cookie directly; an unrelated admin cookie in the same
  // browser must not shadow the parent session for shop checkout.
  const me = await getCurrentParent();
  if (!me)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (me.students.length === 0)
    return failJson({
      parentId: me.id, req, status: 400,
      message: "No student attached", kind: "rule.block",
    });

  const body = Body.parse(await req.json());
  // Read with the first student as the "active" anchor — the cart already
  // contains lines for every sibling thanks to studentId tagging on add.
  const anchor = me.students[0];
  const cart = await readCart(
    me.id,
    anchor.school.id,
    anchor.grade ?? null,
    anchor.schoolGivenGrade ?? anchor.grade ?? null,
    Array.from(new Set(me.students.map((s) => s.school.id))),
    anchor.id
  );
  if (cart.lines.length === 0)
    return failJson({
      parentId: me.id, req, status: 400,
      message: "Cart is empty", kind: "rule.block",
    });

  for (const line of cart.lines) {
    if (line.qty > line.stockLeft) {
      return failJson({
        parentId: me.id, req, status: 409,
        message: `Only ${line.stockLeft} of ${line.productName} (${line.size}) available`,
        kind: "rule.block",
        details: {
          rule: "stock_block",
          variantId: line.variantId,
          requested: line.qty, available: line.stockLeft,
          product: line.productName, size: line.size,
        },
      });
    }
  }

  // Gate: CCAvenue's hosted page rejects malformed billing_email with
  // `31011: billing_email: Invalid Parameter`, which surfaces as an instant
  // bounce-back to a "placed/failed" order. Validate ONLY when the parent
  // actually has an email saved — the no-email case is the norm for most
  // parents and falls through to the `${phone}@no-email.local` synthetic
  // billing_email lower down (CCAvenue accepts that one fine).
  const trimmedEmail = me.email?.trim() ?? "";
  if (trimmedEmail !== "" && !z.string().email().safeParse(trimmedEmail).success) {
    return NextResponse.json(
      {
        error:
          "The email address on your account is invalid. Please update it from your account before paying.",
        code: "INVALID_EMAIL",
        redirectTo: "/account",
      },
      { status: 400 }
    );
  }

  // Group cart lines by sibling. Each (student, school) pair becomes its
  // OWN orders row so school-side fulfillment stays unambiguous; all rows
  // share an `order_group_id` so the parent's account view + CCAvenue
  // payment can treat the basket as one transaction.
  const studentById = new Map(me.students.map((s) => [s.id, s]));
  const groups = new Map<
    string,
    {
      studentId: string;
      schoolId: string;
      schoolName: string;
      gradeClass: string | null;
      gradeRaw: string | null;
      lines: CartLine[];
    }
  >();
  for (const l of cart.lines) {
    // Untagged legacy lines fall back to the anchor student so they still
    // get an order. New writes always carry studentId.
    const sid = l.studentId ?? anchor.id;
    const s = studentById.get(sid);
    if (!s) continue; // student no longer linked to parent; skip
    const key = `${sid}::${s.school.id}`;
    const g =
      groups.get(key) ??
      {
        studentId: sid,
        schoolId: s.school.id,
        schoolName: s.school.name,
        gradeClass: s.class ?? null,
        gradeRaw: s.grade ?? null,
        lines: [] as CartLine[],
      };
    g.lines.push(l);
    groups.set(key, g);
  }

  const subtotalP = cart.subtotal * 100;
  const resolvedCoupon = await resolveAppliedCoupon(
    { id: me.id, students: me.students },
    subtotalP,
  );
  const discountP = resolvedCoupon?.discountPaise ?? 0;
  const warehouseId = await getDefaultWarehouseId();
  const orderGroupId = randomUUID();

  // ERPNext-driven shipping fee — compute PER GROUP because the rule set
  // is per-school. The basket-level totals (paid + discount) inform each
  // rule but the school selector differs.
  const { computeShippingFeePaise } = await import("@/lib/delivery-fee");

  // Build per-group totals first so we can compute the basket grand total
  // (the figure CCAvenue captures). Coupon discount is applied to the
  // basket-level total — we proportionally split across child orders so
  // each order's totals still reconcile.
  const groupArr = Array.from(groups.values());
  const groupShippingPaise: number[] = [];
  for (const g of groupArr) {
    const sub = g.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) * 100;
    const { shippingPaise } = await computeShippingFeePaise({
      schoolId: g.schoolId,
      productIds: g.lines.filter((l) => l.unitPrice > 0).map((l) => l.productId),
      subtotalPaise: sub,
      grade: g.gradeRaw,
    });
    groupShippingPaise.push(shippingPaise);
  }
  const groupSubtotalsP = groupArr.map((g) =>
    g.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) * 100
  );
  const totalShippingP = groupShippingPaise.reduce((s, n) => s + n, 0);
  const basketTotalP = subtotalP + totalShippingP - discountP;

  // Proportional discount split — keeps per-order totals consistent with
  // the basket-level coupon application. Last group absorbs the rounding
  // remainder so the sum of order totals exactly matches basketTotalP.
  const discountAlloc: number[] = [];
  let remaining = discountP;
  for (let i = 0; i < groupArr.length; i++) {
    if (i === groupArr.length - 1) {
      discountAlloc.push(remaining);
    } else {
      const share = subtotalP === 0 ? 0 : Math.floor(
        (groupSubtotalsP[i] / subtotalP) * discountP
      );
      discountAlloc.push(share);
      remaining -= share;
    }
  }

  // Insert one orders row per group, all stamped with orderGroupId.
  const created: { id: string; orderNumber: string; total: number }[] = [];
  for (let i = 0; i < groupArr.length; i++) {
    const g = groupArr[i];
    const sub = groupSubtotalsP[i];
    const ship = groupShippingPaise[i];
    const disc = discountAlloc[i];
    const tot = sub + ship - disc;
    const orderNumber = await generateOrderNumber();
    const [row] = await db
      .insert(orders)
      .values({
        orderNumber,
        parentId: me.id,
        studentId: g.studentId,
        schoolId: g.schoolId,
        status: "placed",
        paymentStatus: "pending",
        subtotal: sub,
        tax: 0,
        shipping: ship,
        discount: disc,
        total: tot,
        shippingAddress: body.address,
        placedAt: new Date(),
        gradeSnapshot: g.gradeClass,
        schoolNameSnapshot: g.schoolName,
        warehouseId,
        financialYear: financialYearOf(),
        placeOfSupply: placeOfSupply(body.address.pincode),
        gstCategory: "Unregistered",
        couponId: resolvedCoupon?.coupon.id ?? null,
        orderGroupId,
      })
      .returning();
    created.push({ id: row.id, orderNumber, total: tot });

    await db.insert(orderItems).values(
      g.lines.map((l) => ({
        orderId: row.id,
        variantId: l.variantId,
        nameSnapshot: l.productName,
        imageSnapshot: l.imageUrl,
        size: l.size,
        qty: l.qty,
        unitPrice: l.unitPrice * 100,
        total: l.unitPrice * l.qty * 100,
        bundleSelections: l.bundleSelections ?? null,
      }))
    );
  }

  const primary = created[0];

  // ── Zero-value basket short-circuit ────────────────────────────────
  // Complimentary kits (e.g. St. Michaels free bookkit) compute to ₹0.
  // CCAvenue can't process a ₹0 charge — it rejects the request and the
  // payment is marked failed even though the order is logically complete.
  // For ₹0 baskets we bypass the gateway entirely: mark every sibling
  // order paid + confirmed and write a finalized "complimentary" payment
  // row. The frontend skips the form-post and lands on the success page.
  if (basketTotalP === 0) {
    const now = new Date();
    await db
      .update(orders)
      .set({
        paymentStatus: "paid",
        status: "confirmed",
        confirmedAt: now,
      })
      .where(eq(orders.orderGroupId, orderGroupId));
    // One payment row per order in the basket — the admin order page
    // reads `payments` per-order, so siblings without a row showed up
    // as "No payment row recorded yet" (root cause of the missing-CC-
    // avenue-details reports on 2026-06-04). Even though every comp
    // order is ₹0, each sibling gets its own row keyed to its order_id.
    for (const sib of created) {
      await db.insert(payments).values({
        orderId: sib.id,
        provider: "complimentary",
        amount: 0,
        status: "paid",
        paymentFlow: "ONLINE",
        gatewayProvider: "COMPLIMENTARY",
        gatewayOrderId: sib.orderNumber,
        internalPaymentReference:
          sib.id === primary.id ? primary.orderNumber : `sibling-of:${primary.id}`,
        paidAmount: "0.00",
        paidCurrency: "INR",
        paymentDate: now.toISOString().slice(0, 10),
        refundStatus: "NOT_REQUESTED",
        paymentAttemptCount: 1,
        paymentRetryCount: 0,
        paymentFinalized: true,
        method: "complimentary",
        paymentMode: "Complimentary",
        gatewayResponseMessage: "Zero-value basket — gateway bypassed",
      });
    }
    if (resolvedCoupon) {
      try {
        await clearAppliedCoupon(me.id);
      } catch {}
    }
    try {
      await clearCart(me.id);
    } catch {}
    // Mirror the CCAvenue-finalize side-effect: enqueue an `order.created`
    // event for every sibling in the basket so audit.inventre.in sees
    // these zero-value orders. Without this the complimentary short-circuit
    // bypasses both the gateway *and* the audit notification — see
    // lib/ccavenue-finalize.ts:300 for the paid-flow counterpart.
    for (const sib of created) {
      void enqueueOrderEvent(sib.id, "order.created");
    }
    return NextResponse.json({
      orderId: primary.id,
      orderNumber: primary.orderNumber,
      orderGroupId,
      siblingOrders: created.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        total: o.total,
      })),
      complimentary: true,
      redirectTo: `/shop/orders/${primary.id}?payment=success&placed=1`,
    });
  }

  // CCAvenue physically captures the BASKET total in one transaction
  // (tracking id shared across the group). But each order — primary or
  // sibling — gets its OWN payments row stamped with that order's own
  // total, so the admin order page can display per-kid amounts truthfully
  // instead of inflating the primary's row with the basket sum.
  // SUM(payment.amount) across the group still equals the basket charge,
  // so the CCAvenue admin GMV aggregate is unchanged. Finalize-time
  // sibling propagation lives in lib/ccavenue-finalize.ts.
  await db.insert(payments).values({
    orderId: primary.id,
    provider: "ccavenue",
    amount: primary.total,
    status: "pending",
    paymentFlow: "ONLINE",
    gatewayProvider: "CCAVENUE",
    gatewayOrderId: primary.orderNumber,
    internalPaymentReference: primary.orderNumber,
    paidCurrency: "INR",
    refundStatus: "NOT_REQUESTED",
    paymentAttemptCount: 1,
    paymentRetryCount: 0,
    paymentFinalized: false,
  });

  if (resolvedCoupon) {
    try {
      await clearAppliedCoupon(me.id);
    } catch {}
  }

  // Only enforce gateway config when we actually need it (basket > 0).
  if (!isCCAvenueConfigured()) {
    return NextResponse.json(
      { error: "CCAvenue not configured on this server" },
      { status: 503 }
    );
  }

  const redirectPayload = buildRedirectPayload({
    orderId: primary.id,
    amountRupees: Math.round(basketTotalP / 100),
    customerName: me.name ?? body.address.receiverName,
    customerEmail: me.email ?? `${me.phone}@no-email.local`,
    customerPhone: me.phone,
    billingAddress: {
      line1: body.address.line1,
      city: body.address.city,
      state: body.address.state,
      pincode: body.address.pincode,
    },
  });

  return NextResponse.json({
    orderId: primary.id,
    orderNumber: primary.orderNumber,
    orderGroupId,
    siblingOrders: created.map((o) => ({ id: o.id, orderNumber: o.orderNumber, total: o.total })),
    ...redirectPayload,
  });
}
