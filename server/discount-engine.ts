import "server-only";
import { eq, and, or, isNull, lte, gte, sql, desc } from "drizzle-orm";
import { db } from "@/db/client";
import {
  discountRules,
  discountUsages,
  productVariants,
  products,
} from "@/db/schema";

/**
 * Discount engine — pure-ish: takes cart lines + optional code + customer,
 * returns the set of discounts applied with line-level apportionment.
 *
 * Resolution:
 *   1. Auto-apply rules (no code) — evaluated server-side every cart-read.
 *   2. Code rules — evaluated only when explicitly applied via /api/cart/apply-coupon.
 *   3. Stackability rules:
 *        - non-stackable rules are mutually exclusive (highest priority wins)
 *        - stackable rules combine
 *   4. Usage limits:
 *        - max_uses_total checked vs used_count
 *        - max_uses_per_customer checked vs discountUsages
 *   5. Validity windows:  validFrom ≤ now ≤ validUntil (or NULL)
 *   6. Min order amount / qty:  must be met or rule is skipped
 */

export type CartLineForDiscount = {
  variantId: string;
  productId: string;
  categoryId: string | null;
  schoolId: string | null;
  qty: number;
  unitPrice: number; // paise
};

export type AppliedDiscount = {
  ruleId: string;
  ruleName: string;
  code: string | null;
  type: "percent" | "flat" | "bulk" | "bxgy" | "free_shipping";
  amountSaved: number; // paise total
  perLineSaved: Record<string, number>; // variantId → paise
};

export type DiscountResult = {
  applied: AppliedDiscount[];
  totalSaved: number;
  shippingFreeFromRule: boolean;
};

export async function evaluateDiscounts(args: {
  lines: CartLineForDiscount[];
  customerId?: string | null;
  schoolId?: string | null;
  code?: string | null; // explicit code provided by user
}): Promise<DiscountResult> {
  const { lines, customerId, schoolId, code } = args;
  const now = new Date();

  // Pull candidate rules: active, in validity, either auto-apply OR matching code
  const candidates = await db
    .select()
    .from(discountRules)
    .where(
      and(
        eq(discountRules.isActive, true),
        or(isNull(discountRules.validFrom), lte(discountRules.validFrom, now)),
        or(isNull(discountRules.validUntil), gte(discountRules.validUntil, now))
      )
    )
    .orderBy(desc(discountRules.priority));

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  // Filter to applicable rules
  const ruleApplies = (r: typeof candidates[number]): boolean => {
    if (r.code) {
      // Code rule — only applies if code matches
      if (!code || code.toLowerCase() !== r.code.toLowerCase()) return false;
    }
    if (r.minOrderAmount && subtotal < r.minOrderAmount) return false;
    if (r.minQty && totalQty < r.minQty) return false;
    if (r.maxUsesTotal != null && r.usedCount >= r.maxUsesTotal) return false;
    // School / category / product / variant scope
    if (r.appliesTo === "school" && r.schoolId && r.schoolId !== schoolId) return false;
    return true;
  };

  // Per-customer usage check
  const filtered: typeof candidates = [];
  for (const r of candidates) {
    if (!ruleApplies(r)) continue;
    if (r.maxUsesPerCustomer != null && customerId) {
      const [usage] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(discountUsages)
        .where(
          and(
            eq(discountUsages.ruleId, r.id),
            eq(discountUsages.parentId, customerId)
          )
        );
      if (Number(usage?.count ?? 0) >= r.maxUsesPerCustomer) continue;
    }
    filtered.push(r);
  }

  // Apply rules: non-stackable wins by priority; stackable accumulates
  const applied: AppliedDiscount[] = [];
  let usedNonStackable = false;
  let shippingFree = false;

  for (const r of filtered) {
    if (!r.isStackable && usedNonStackable) continue;

    const matched = lines.filter((l) => lineMatchesRule(l, r));
    if (matched.length === 0) continue;

    const matchedSubtotal = matched.reduce(
      (s, l) => s + l.qty * l.unitPrice,
      0
    );

    let totalSaved = 0;
    const perLine: Record<string, number> = {};

    if (r.type === "percent") {
      const pct = Number(r.value);
      let raw = Math.round((matchedSubtotal * pct) / 100);
      if (r.maxDiscountAmount != null && raw > r.maxDiscountAmount) {
        raw = r.maxDiscountAmount;
      }
      totalSaved = raw;
      // Apportion proportionally
      for (const l of matched) {
        const lineVal = l.qty * l.unitPrice;
        perLine[l.variantId] = Math.round((raw * lineVal) / matchedSubtotal);
      }
    } else if (r.type === "flat") {
      const flat = Math.min(Number(r.value) * 100, matchedSubtotal); // value in rupees → paise
      totalSaved = flat;
      for (const l of matched) {
        const lineVal = l.qty * l.unitPrice;
        perLine[l.variantId] = Math.round((flat * lineVal) / matchedSubtotal);
      }
    } else if (r.type === "free_shipping") {
      shippingFree = true;
      totalSaved = 0; // shipping reduction handled separately by checkout
    }
    // bulk and bxgy are stubbed for now — engine can be extended.

    if (totalSaved <= 0 && r.type !== "free_shipping") continue;

    applied.push({
      ruleId: r.id,
      ruleName: r.name,
      code: r.code,
      type: r.type,
      amountSaved: totalSaved,
      perLineSaved: perLine,
    });

    if (!r.isStackable) usedNonStackable = true;
  }

  const totalSaved = applied.reduce((s, a) => s + a.amountSaved, 0);

  // Invariants — guard against engine bugs that double-apply or over-discount.
  // These should never fire in correct code; if they do, fail loud rather than
  // silently letting the customer pay nothing.
  if (totalSaved > subtotal) {
    throw new Error(
      `Discount engine invariant: totalSaved=${totalSaved} > subtotal=${subtotal}`
    );
  }
  for (const l of lines) {
    const lineVal = l.qty * l.unitPrice;
    let perLineTotal = 0;
    for (const a of applied) perLineTotal += a.perLineSaved[l.variantId] ?? 0;
    if (perLineTotal > lineVal) {
      throw new Error(
        `Discount engine invariant: perLine ${perLineTotal} > line ${lineVal} for variant ${l.variantId}`
      );
    }
  }

  return {
    applied,
    totalSaved,
    shippingFreeFromRule: shippingFree,
  };
}

/**
 * Combine all discount sources (coupons/auto-rules + loyalty redemption +
 * gift-card amount) and assert the total is bounded by the order subtotal.
 *
 * Call this at the checkout/admin-pos site that resolves the final payable.
 * Callers MUST clamp each source against the running remainder before
 * applying — this helper just enforces the invariant.
 */
export function assertStackedDiscount(args: {
  subtotalPaise: number;
  rulesSavedPaise: number;
  loyaltySavedPaise: number;
  giftCardSavedPaise: number;
}): { totalDiscountPaise: number; payablePaise: number } {
  const { subtotalPaise, rulesSavedPaise, loyaltySavedPaise, giftCardSavedPaise } = args;
  if (rulesSavedPaise < 0 || loyaltySavedPaise < 0 || giftCardSavedPaise < 0) {
    throw new Error("assertStackedDiscount: all components must be non-negative");
  }
  const total = rulesSavedPaise + loyaltySavedPaise + giftCardSavedPaise;
  if (total > subtotalPaise) {
    throw new Error(
      `Stacked discount invariant: rules=${rulesSavedPaise} + loyalty=${loyaltySavedPaise} + gift=${giftCardSavedPaise} = ${total} > subtotal=${subtotalPaise}`
    );
  }
  return { totalDiscountPaise: total, payablePaise: subtotalPaise - total };
}

function lineMatchesRule(
  line: CartLineForDiscount,
  rule: { appliesTo: string; schoolId: string | null; categoryId: string | null; productId: string | null; variantId: string | null }
): boolean {
  if (rule.appliesTo === "all") return true;
  if (rule.appliesTo === "school") return rule.schoolId === line.schoolId;
  if (rule.appliesTo === "category")
    return rule.categoryId !== null && rule.categoryId === line.categoryId;
  if (rule.appliesTo === "product")
    return rule.productId !== null && rule.productId === line.productId;
  if (rule.appliesTo === "variant")
    return rule.variantId !== null && rule.variantId === line.variantId;
  return false;
}

export async function recordDiscountUsage(args: {
  applied: AppliedDiscount[];
  parentId?: string | null;
  orderId?: string | null;
}): Promise<void> {
  if (args.applied.length === 0) return;
  await db.insert(discountUsages).values(
    args.applied.map((a) => ({
      ruleId: a.ruleId,
      parentId: args.parentId ?? null,
      orderId: args.orderId ?? null,
      amountSaved: a.amountSaved,
    }))
  );
  for (const a of args.applied) {
    await db
      .update(discountRules)
      .set({ usedCount: sql`${discountRules.usedCount} + 1` })
      .where(eq(discountRules.id, a.ruleId));
  }
}
