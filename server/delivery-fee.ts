/**
 * Resolve the shipping fee for a cart from the ERPNext "Delivery Fee Rule"
 * doctype (mirrored read in lib/erp/delivery-fee-rules.ts).
 *
 * Rules are keyed by `school` (ERPNext name, e.g. "TSUSC-TSUS Chennai")
 * which maps to `schools.erp_name`. Each rule scopes to:
 *   - an amount range (min_amount ≤ subtotal ≤ max_amount; max_amount=0 = no cap)
 *   - a set of applicable_item_groups (empty = applies to ALL items). The
 *     admin panel writes one of two values: "Uniform" or "Books". Legacy
 *     ERPNext rules using "Books Bundle"/"BOOKKIT"/"Uniforms" are normalized
 *     to the same two categories on read so they keep matching.
 *   - an optional grade (stored locally in `delivery_fee_rule_grades` since
 *     the ERPNext doctype has no grade field). Absent row = applies to all
 *     grades for the school.
 *
 * Match logic:
 *   1. Resolve the school's erp_name.
 *   2. From the active rules for that school, pick the first one whose
 *      amount range covers the cart subtotal AND grade matches (or rule is
 *      unscoped) AND at least one cart line sits in an applicable category
 *      (or the rule's category list is empty).
 *   3. Return that rule's delivery_fee in paise. No match → 0.
 *
 * Cache: ERPNext is the source of truth but rules barely change, so we
 * cache the full list for 5 minutes in-process. Admin create/update/delete
 * actions call `bustDeliveryFeeCache()` so changes show on the storefront
 * immediately.
 */
import "server-only";
import { eq, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { schools, deliveryFeeRuleGrades } from "@/db/schema";
import { listDeliveryFeeRules, type DeliveryFeeRule } from "@/server/erp/delivery-fee-rules";
import { cached, invalidate } from "@/server/cache";

// Redis-backed instead of an in-process variable so admin bust calls and
// customer reads stay in sync even if the runtime spawns workers (or a
// future revision adds multiple app containers behind a load balancer).
// Short TTL = max 60s drift even if a future write path forgets to call
// `bustDeliveryFeeCache()`.
const CACHE_KEY = "delivery-fees:all";
// Very short — admin writes invalidate immediately, so this only protects
// against bursty reads (e.g. several parents loading carts within seconds).
const CACHE_TTL_S = 5;

/** Last-known snapshot, kept in process memory ONLY for the rare case
 *  where Redis returns successfully but ERPNext later goes down between
 *  calls. We still primarily read through Redis. */
let lastGood: DeliveryFeeRule[] | null = null;

/** Drop the rules cache. Called by admin create/update/delete so the
 *  storefront sees changes on the very next request. */
export async function bustDeliveryFeeCache(): Promise<void> {
  await invalidate(CACHE_KEY);
}

async function rulesCached(): Promise<DeliveryFeeRule[]> {
  try {
    const rules = await cached(CACHE_KEY, CACHE_TTL_S, async () => {
      const fetched = await listDeliveryFeeRules();
      lastGood = fetched;
      return fetched;
    });
    if (rules && rules.length > 0) lastGood = rules;
    return rules ?? [];
  } catch (e) {
    // Fail-soft: if ERPNext is unreachable, return the last good snapshot
    // (or empty if we never had one). Better to under-charge shipping than
    // block checkout entirely.
    console.error(
      "[delivery-fee] ERPNext fetch failed:",
      e instanceof Error ? e.message : e
    );
    return lastGood ?? [];
  }
}

/** Two-category model the admin UI writes; legacy values normalize into these. */
export type DeliveryFeeCategory = "Uniform" | "Books";

/** Normalize a raw item_group string from an existing rule to one of our
 *  two categories. Unknown values fall through to "Uniform" — safer than
 *  silently dropping the rule. */
function normalizeCategory(raw: string): DeliveryFeeCategory {
  if (/book/i.test(raw)) return "Books";
  return "Uniform";
}

export async function computeShippingFeePaise(args: {
  schoolId: string;
  productIds: string[];
  subtotalPaise: number;
  /** Student's catalog grade (students.grade), used to filter rules that
   *  are scoped to a specific grade. Undefined = no grade constraint. */
  grade?: string | null;
}): Promise<{ shippingPaise: number; rule: DeliveryFeeRule | null }> {
  if (!args.schoolId || args.productIds.length === 0) {
    return { shippingPaise: 0, rule: null };
  }

  const [schoolRow] = await db
    .select({ erpName: schools.erpName })
    .from(schools)
    .where(eq(schools.id, args.schoolId))
    .limit(1);
  const schoolErpName = schoolRow?.erpName;
  if (!schoolErpName) return { shippingPaise: 0, rule: null };

  const all = await rulesCached();
  const candidates = all.filter(
    (r) => r.is_active === 1 && r.school === schoolErpName
  );
  if (candidates.length === 0) return { shippingPaise: 0, rule: null };

  // Subtotal-range filter (max_amount = 0 means "no upper cap").
  const subtotalRupees = args.subtotalPaise / 100;
  const inRange = candidates.filter((r) => {
    const minOk = (r.min_amount ?? 0) <= subtotalRupees;
    const maxOk = !r.max_amount || r.max_amount === 0 || subtotalRupees <= r.max_amount;
    return minOk && maxOk;
  });
  if (inRange.length === 0) return { shippingPaise: 0, rule: null };

  // Grade filter. The local `delivery_fee_rule_grades` table holds a row
  // per scoped rule. Rules without a row are unscoped (apply to all grades).
  const gradeByRule = await loadRuleGrades(inRange.map((r) => r.name));
  const gradeOk = (r: DeliveryFeeRule) => {
    const scoped = gradeByRule.get(r.name);
    if (!scoped) return true;
    return !!args.grade && scoped === args.grade;
  };

  // Precedence: a grade-scoped rule MUST beat a grade-NULL rule for the
  // same school+category. The previous implementation iterated in
  // `updated_at DESC` order and picked the first matching rule, which
  // meant an unscoped rule edited last would shadow a more-specific
  // grade-scoped rule. We now partition into grade-scoped vs unscoped
  // and exhaust the scoped bucket first.
  const scopedCandidates = inRange.filter((r) => {
    const s = gradeByRule.get(r.name);
    return s && !!args.grade && s === args.grade;
  });
  const unscopedCandidates = inRange.filter((r) => !gradeByRule.get(r.name));
  const orderedCandidates = [...scopedCandidates, ...unscopedCandidates];

  // Category filter. Empty applicable_item_groups → applies to all.
  // Otherwise: derive each cart product's category from its name and require
  // at least one cart product in the rule's allowed categories.
  // (Magic Box products are filtered out at the SQL layer inside
  // loadCartCategories so they never contribute to either bucket — fixed-
  // price product per ops directive.)
  let cartCategories: Set<DeliveryFeeCategory> | null = null;
  for (const rule of orderedCandidates) {
    const allowed = rule.applicable_item_groups.map((g) => normalizeCategory(g.item_group));
    if (allowed.length === 0) {
      return { shippingPaise: Math.round(rule.delivery_fee * 100), rule };
    }
    if (!cartCategories) {
      cartCategories = await loadCartCategories(args.productIds);
    }
    if (allowed.some((c) => cartCategories!.has(c))) {
      return { shippingPaise: Math.round(rule.delivery_fee * 100), rule };
    }
  }
  return { shippingPaise: 0, rule: null };
}

async function loadRuleGrades(ruleNames: string[]): Promise<Map<string, string>> {
  if (ruleNames.length === 0) return new Map();
  const rows = await db
    .select({ ruleName: deliveryFeeRuleGrades.ruleName, grade: deliveryFeeRuleGrades.grade })
    .from(deliveryFeeRuleGrades)
    .where(inArray(deliveryFeeRuleGrades.ruleName, ruleNames));
  return new Map(rows.map((r) => [r.ruleName, r.grade]));
}

/**
 * Map each cart product to a Delivery Fee category. Per the simplified
 * model: products whose name contains "bookkit" or "bookset" are Books;
 * everything else is Uniform. This is intentionally name-based (not
 * `products.item_group`) because the latter is often NULL on rows created
 * outside the ERPNext feed.
 *
 * Magic Box products are excluded at the SQL layer — they're fixed-price
 * per ops, so they never participate in shipping-fee category resolution.
 * Carts that contain ONLY Magic Box lines will end up with an empty
 * category set and computeShippingFeePaise returns 0.
 */
async function loadCartCategories(productIds: string[]): Promise<Set<DeliveryFeeCategory>> {
  if (productIds.length === 0) return new Set();
  const rows = await db.execute(sql`
    SELECT name FROM products
    WHERE id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
      AND kind::text <> 'magic_box'
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{
    name: string | null;
  }>;
  const out = new Set<DeliveryFeeCategory>();
  for (const r of list) {
    if (!r.name) continue;
    if (/bookkit|bookset/i.test(r.name)) {
      out.add("Books");
    } else {
      out.add("Uniform");
    }
  }
  return out;
}
