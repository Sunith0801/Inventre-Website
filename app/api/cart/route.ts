import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, ne, inArray, ilike, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  products,
  productVariants,
  productSchool,
  productGrades,
  carts,
  cartItems,
  orders,
  orderItems,
  payments,
  schools,
} from "@/db/schema";
import { normalizeGrade } from "@/server/grade-filter";

// Schools where free (0-price) bookkits are limited to 1 per student ever.
// The bookkit rules themselves live in features/bookkit/domain/eligibility.ts:
// pure, database-free and covered by 16 tests including an equivalence proof
// against the branching that used to sit inline in this file. This route
// gathers the facts; that module decides.
import { getCurrentParent, type CurrentParent } from "@/server/session";
import { readCart, addToCart, setCartQty, clearCart } from "@/server/repos/cart";
import { failJson } from "@/server/observability/fail-json";
import { parseJson } from "@/server/api-handler";
import {
  FREE_BOOKKIT_RESTRICTED_SCHOOL_CODES,
  decideBookkitLimit,
  effectivePricePaise,
  isBookkitName,
  isRestrictedFreeBookkit,
} from "@/features/bookkit/domain/eligibility";
import {
  isCatalogDisabledSchool,
  catalogDisabledMessage,
} from "@/lib/school-catalog-gate";

async function requireParent() {
  const me = await getCurrentParent();
  if (!me) return null;
  return me;
}

function resolveActive(me: CurrentParent, requestedId: string | null | undefined) {
  if (requestedId) {
    const match = me.students.find((s) => s.id === requestedId);
    if (match) return match;
  }
  return me.students[0];
}

/**
 * Mutation guard for /api/cart POST/PATCH. The bug we're fixing: when a
 * client omits or sends a stale `studentId`, `resolveActive` silently
 * falls back to `me.students[0]`, so the cart line lands on whichever
 * sibling Postgres happens to return first. That caused multi-grade
 * baskets where a UKG box landed on a Nursery sibling's order
 * (SAL-ORD-2026-29243 and friends, 2026-06-05).
 *
 * GET intentionally still uses the silent fallback — it's a read of the
 * parent's whole cart and the "active" student is just for grade-sweep
 * scoping; rejecting reads would break the cart header for any tab that
 * lost its URL param. Writes must be explicit.
 */
function requireActiveStudent(
  me: CurrentParent,
  requestedId: string | null | undefined
): { ok: true; student: NonNullable<ReturnType<typeof resolveActive>> } | { ok: false; error: string } {
  if (!requestedId) {
    // Single-child families: a missing studentId is unambiguous — the
    // only child IS the active child, no risk of cross-sibling tagging.
    // Belt-and-braces for the StudentBar/PDP defaulting fix; covers
    // deep-links from non-storefront contexts where the URL never went
    // through StudentBar (Gyanveer Bojja / 22BP1184 case, 2026-06-05).
    if (me.students.length === 1) {
      return { ok: true, student: me.students[0] };
    }
    return { ok: false, error: "Missing studentId — please pick a child before adding to cart." };
  }
  const match = me.students.find((s) => s.id === requestedId);
  if (!match) {
    return { ok: false, error: "That child is no longer on your account — please pick another." };
  }
  return { ok: true, student: match };
}

/**
 * One magic box per student, lifetime. Applies regardless of price
 * (₹0 complimentary or full-price) and across magic_box products —
 * a parent who placed an UKG box for a Nursery sibling can't go back
 * and add a Nursery box later. The quota is burned only by a magic-box
 * order that is a REAL purchase or a LIVE payment:
 *   • paid / refunded                        → blocks
 *   • pending + fresh (active checkout)       → blocks (double-buy race guard)
 *   • pending + money in play (Awaited /      → blocks (money debited/captured)
 *     Auto-Reversed / Successful-not-latched)
 * It is FREED when the prior attempt never took money:
 *   • payment failed / cancelled              → frees
 *   • pending + stale + "Initiated"           → abandoned checkout, frees
 * (the last case is SAL-ORD-2026-34978/80/84 — 13-day-old Initiated boxes
 *  that wrongly blocked the sibling from buying).
 *
 * Returns the error string if the add should be blocked, null otherwise.
 */
// A pending magic-box order keeps the slot only while it's a LIVE payment.
// 1h comfortably covers an active checkout and any real gateway settlement;
// an abandoned "Initiated" attempt never resolves and is older than this.
const FRESH_PENDING_MS = 60 * 60 * 1000;

/** True when a pending payment has money actually in play — debited and
 *  settling ("Awaited"/"Auto-Reversed"), or captured but not yet latched to
 *  paid ("Successful"/"success:…"). Reads the latest known CCAvenue status
 *  from the reconcile message ("…status=Awaited") or the raw gateway blob.
 *  Anything else — notably "Initiated" — means no money was debited. */
function pendingPaymentHasMoneyInPlay(
  message: string | null | undefined,
  raw: unknown,
): boolean {
  const msg = (message ?? "").toLowerCase();
  if (/\bsuccess\b/.test(msg)) return true; // latch-bug shape: "success:<id> …"
  let status = "";
  const m = msg.match(/status=([a-z-]+)/i);
  if (m) {
    status = m[1];
  } else if (raw && typeof raw === "object") {
    const os = (raw as Record<string, unknown>).order_status;
    if (typeof os === "string") status = os;
  }
  const s = status.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return (
    s === "awaited" ||
    s === "autoreversed" ||
    s === "successful" ||
    s === "success" ||
    s === "shipped"
  );
}

// Result of a one-per-student limit check. `orderNumber` is the existing
// order the customer should be pointed at ("already placed — view"); null when
// the block is from an in-cart item (no order to link yet) or a qty cap.
type LimitBlock = { message: string; orderNumber: string | null };

async function checkMagicBoxLimit(
  parentId: string,
  studentId: string | null,
  variantId: string,
  qty: number,
): Promise<LimitBlock | null> {
  if (!studentId) return null;

  const [variantRow] = await db
    .select({ kind: products.kind })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, variantId))
    .limit(1);
  if (variantRow?.kind !== "magic_box") return null;

  if (qty > 1) {
    return { message: "Only 1 Magic Box can be added per student.", orderNumber: null };
  }

  // Cart side: any OTHER magic_box variant already tagged to this
  // student. We exclude the same variantId so a parent re-clicking
  // "Add" on the box they already added doesn't see this error
  // (the regular qty merge in mirrorWriteToDb handles that path).
  const [cartRow] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.parentId, parentId))
    .limit(1);
  if (cartRow) {
    const cartMagicBoxes = await db
      .select({ id: cartItems.id })
      .from(cartItems)
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          eq(cartItems.cartId, cartRow.id),
          eq(cartItems.studentId, studentId),
          eq(products.kind, "magic_box"),
          ne(cartItems.variantId, variantId),
        ),
      )
      .limit(1);
    if (cartMagicBoxes.length > 0) {
      return {
        message:
          "A Magic Box is already in your cart for this student. Only 1 Magic Box per student is allowed.",
        orderNumber: null,
      };
    }
  }

  // Order history side. Pull this student's non-cancelled, non-failed
  // magic_box orders with their latest payment, then decide per-order
  // whether it still occupies the slot (see checkMagicBoxLimit doc above).
  // A genuine ₹0 complimentary box short-circuits to paid+confirmed in the
  // zero-value create-order path, so real redemptions still block.
  const priorRows = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      paymentStatus: orders.paymentStatus,
      orderCreatedAt: orders.createdAt,
      payCreatedAt: payments.createdAt,
      payMessage: payments.gatewayResponseMessage,
      payRaw: payments.raw,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(payments, eq(payments.orderId, orders.id))
    .where(
      and(
        eq(orders.parentId, parentId),
        eq(orders.studentId, studentId),
        eq(products.kind, "magic_box"),
        ne(orders.status, "cancelled"),
        ne(orders.paymentStatus, "failed"),
      ),
    );

  // Collapse to one row per order, keeping its most-recent payment.
  const latestByOrder = new Map<string, (typeof priorRows)[number]>();
  for (const r of priorRows) {
    const prev = latestByOrder.get(r.orderId);
    const t = r.payCreatedAt ? new Date(r.payCreatedAt).getTime() : 0;
    const pt = prev?.payCreatedAt ? new Date(prev.payCreatedAt).getTime() : -1;
    if (!prev || t > pt) latestByOrder.set(r.orderId, r);
  }

  const now = Date.now();
  const blockingOrders = Array.from(latestByOrder.values()).filter((r) => {
    // failed/cancelled are filtered out above → non-pending here is paid or
    // refunded, both of which block.
    if (r.paymentStatus !== "pending") return true;
    const created = r.orderCreatedAt ? new Date(r.orderCreatedAt).getTime() : 0;
    const fresh = created > 0 && now - created < FRESH_PENDING_MS;
    return fresh || pendingPaymentHasMoneyInPlay(r.payMessage, r.payRaw);
  });
  if (blockingOrders.length > 0) {
    // Point the customer at the REAL order — prefer a paid/refunded
    // (non-pending) one over a still-settling pending block.
    const best =
      blockingOrders.find((r) => r.paymentStatus !== "pending") ??
      blockingOrders[0];
    return {
      message:
        "A Magic Box has already been placed for this student. Only 1 Magic Box per student is allowed.",
      orderNumber: best.orderNumber ?? null,
    };
  }

  return null;
}

/**
 * Resolve the effective price (in paise) for a product given the parent's school.
 * Priority: school override → product base price.
 */
async function resolvePrice(productId: string, schoolId: string | undefined): Promise<number> {
  if (schoolId) {
    const [override] = await db
      .select({ overridePrice: productSchool.overridePrice })
      .from(productSchool)
      .where(and(eq(productSchool.productId, productId), eq(productSchool.schoolId, schoolId)))
      .limit(1);
    if (override?.overridePrice !== null && override?.overridePrice !== undefined) {
      return override.overridePrice;
    }
  }
  const [prod] = await db
    .select({ basePrice: products.basePrice })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return prod?.basePrice ?? 0;
}

/**
 * Check if adding a bookkit to the cart is allowed.
 * Returns an error string if blocked, null if allowed.
 */
// `capToOne` is true whenever the variant is a restricted free bookkit
// (one-per-student, always ₹0) — even when it is allowed (block === null).
// The route passes it to addToCart so the line is pinned to qty 1 and can
// never accumulate via repeated "Add" clicks (the SAL-ORD-2026-37803 bug).
type BookkitLimit = { block: LimitBlock | null; capToOne: boolean };
const NOT_RESTRICTED: BookkitLimit = { block: null, capToOne: false };

async function checkBookkitLimit(
  parentId: string,
  studentId: string | null,
  schoolId: string | undefined,
  variantId: string,
  qty: number
): Promise<BookkitLimit> {
  if (!schoolId) return NOT_RESTRICTED;

  // Run school check + variant lookup + cart + order lookups in parallel.
  // The prior-orders lookup is scoped to (parentId, studentId) so siblings
  // are not penalised for each other's redemptions — the error message
  // promises "per student", which is what we enforce. When studentId is
  // null (legacy session) we skip the order lookup entirely; the cart gate
  // below still runs.
  //
  // A bookkit only counts as "already redeemed" when the order was actually
  // PAID or fulfilled — NOT for a bare `placed`+`pending` checkout that
  // never completed payment. Without this, repeated abandoned attempts
  // (each carrying the free bookkit alongside paid uniforms) lock a student
  // out of a bookkit they never received — exactly what happened to
  // 23SMS0681 (4 unpaid ₹3860 orders, gateway "No Record Found"). A genuine
  // ₹0 complimentary bookkit short-circuits to paid+confirmed in the
  // create-order zero-value path, so real redemptions still count.
  const redeemedStatuses: ("confirmed" | "packed" | "shipped" | "delivered")[] = [
    "confirmed",
    "packed",
    "shipped",
    "delivered",
  ];
  const [schoolRow, variantRow, cartRow, priorOrders] = await Promise.all([
    db.select({ schoolCode: schools.schoolCode }).from(schools).where(eq(schools.id, schoolId)).limit(1),
    db
      .select({ productId: productVariants.productId, productName: products.name, basePrice: products.basePrice })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, variantId))
      .limit(1),
    db.select({ id: carts.id }).from(carts).where(eq(carts.parentId, parentId)).limit(1),
    studentId
      ? db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders).where(and(
          eq(orders.parentId, parentId),
          eq(orders.studentId, studentId),
          or(
            eq(orders.paymentStatus, "paid"),
            inArray(orders.status, redeemedStatuses),
          ),
        ))
      : Promise.resolve([] as { id: string; orderNumber: string }[]),
  ]);

  // These two guards duplicate what `isRestrictedFreeBookkit` decides below.
  // They stay only to skip the price query for the overwhelming majority of
  // cart adds — query economy, not business logic. The authoritative gate is
  // the domain call.
  const schoolCode = schoolRow[0]?.schoolCode ?? null;
  if (!schoolCode || !FREE_BOOKKIT_RESTRICTED_SCHOOL_CODES.includes(schoolCode)) return NOT_RESTRICTED;

  const variant = variantRow[0];
  if (!isBookkitName(variant?.productName)) return NOT_RESTRICTED;

  const [schoolOverride] = await db
    .select({ overridePrice: productSchool.overridePrice })
    .from(productSchool)
    .where(and(eq(productSchool.productId, variant.productId), eq(productSchool.schoolId, schoolId)))
    .limit(1);

  // The authoritative gate. School, product name and "is it actually free"
  // are all decided in one place now.
  const pricePaise = effectivePricePaise(variant.basePrice, schoolOverride?.overridePrice);
  if (!isRestrictedFreeBookkit({ schoolCode, productName: variant.productName, pricePaise })) {
    return NOT_RESTRICTED;
  }

  // From here on this IS a restricted free bookkit → always cap the line to 1.
  //
  // Quantity is decided before the cart and history queries run, exactly as
  // before: `decideBookkitLimit` judges quantity first, so the other two facts
  // cannot affect the answer and the two queries are skipped.
  if (qty > 1) {
    return decideBookkitLimit({ requestedQty: qty, bookkitAlreadyInCart: false, priorRedemption: null });
  }

  // Cart check + order history check in parallel
  const cart = cartRow[0];
  const orderIds = priorOrders.map((o) => o.id);

  const [cartBookkits, bookkitInOrders] = await Promise.all([
    cart
      ? db
          .select({ variantId: cartItems.variantId })
          .from(cartItems)
          .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(
            and(
              eq(cartItems.cartId, cart.id),
              or(ilike(products.name, "%bookkit%"), ilike(products.name, "%bookset%"))
              // NB: we intentionally do NOT exclude the same variantId here.
              // A bookkit already in the cart — including this exact one —
              // means the single allowed slot is taken, so re-adding must be
              // refused instead of silently incrementing (SAL-ORD-2026-37803).
            )
          )
      : Promise.resolve([]),
    orderIds.length > 0
      ? db
          .select({ orderId: orderItems.orderId })
          .from(orderItems)
          .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(
            and(
              inArray(orderItems.orderId, orderIds),
              or(ilike(products.name, "%bookkit%"), ilike(products.name, "%bookset%")),
              eq(orderItems.unitPrice, 0)
            )
          )
          .limit(1)
      : Promise.resolve([] as { orderId: string }[]),
  ]);

  // Link to the order that already carries the complimentary bookkit, so the
  // customer can be told which one.
  const blockingId = bookkitInOrders[0]?.orderId;
  const priorRedemption =
    blockingId === undefined
      ? null
      : { orderNumber: priorOrders.find((o) => o.id === blockingId)?.orderNumber ?? null };

  return decideBookkitLimit({
    requestedQty: qty,
    bookkitAlreadyInCart: cartBookkits.length > 0,
    priorRedemption,
  });
}

/** Union of every school any of this parent's children attends. Used by
 *  the cart school-mismatch sweep so siblings at different schools can
 *  share one cart. */
function allSiblingSchoolIds(me: { students: { school: { id: string } }[] }) {
  return Array.from(new Set(me.students.map((s) => s.school.id)));
}

export async function GET(req: Request) {
  const me = await requireParent();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requestedId = new URL(req.url).searchParams.get("studentId");
  const active = resolveActive(me, requestedId);
  const cart = await readCart(
    me.id,
    active?.school.id,
    active?.grade ?? null,
    active?.schoolGivenGrade ?? active?.grade ?? null,
    allSiblingSchoolIds(me),
    active?.id ?? null
  );
  return NextResponse.json(cart);
}

const BundleSelectionSchema = z.object({
  componentProductId: z.string().uuid(),
  name: z.string(),
  qty: z.number().int(),
  variantId: z.string().uuid(),
  size: z.string(),
});

const PostBody = z.object({
  variantId: z.string().uuid(),
  qty: z.number().int().min(1).max(20).default(1),
  studentId: z.string().uuid().optional(),
  bundleSelections: z.array(BundleSelectionSchema).optional(),
});

export async function POST(req: Request) {
  const me = await requireParent();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await parseJson(req, PostBody);
  if (body instanceof NextResponse) return body;

  const guard = requireActiveStudent(me, body.studentId);
  if (!guard.ok) {
    return failJson({
      parentId: me.id, req, status: 400, message: guard.error,
      details: { studentId: body.studentId ?? null },
      kind: "rule.block",
    });
  }
  const active = guard.student;
  const schoolId = active.school.id;

  // Offline-only schools have no storefront catalog — nothing may enter the
  // cart, even via a direct PDP link or a stale tab.
  if (isCatalogDisabledSchool(active.school)) {
    return failJson({
      parentId: me.id, studentId: active.id, req, status: 409,
      message: catalogDisabledMessage(active.school.name),
      kind: "rule.block",
      details: { rule: "school_catalog_disabled", schoolId, variantId: body.variantId },
    });
  }

  const bookkit = await checkBookkitLimit(me.id, active.id, schoolId, body.variantId, body.qty);
  if (bookkit.block) {
    return failJson({
      parentId: me.id, studentId: active.id, req, status: 409,
      message: bookkit.block.message, kind: "rule.block",
      details: { rule: "bookkit_limit", variantId: body.variantId, qty: body.qty, orderNumber: bookkit.block.orderNumber },
    });
  }

  const magicBoxError = await checkMagicBoxLimit(me.id, active.id, body.variantId, body.qty);
  if (magicBoxError) {
    return failJson({
      parentId: me.id, studentId: active.id, req, status: 409,
      message: magicBoxError.message, kind: "rule.block",
      details: { rule: "magicbox_limit", variantId: body.variantId, qty: body.qty, orderNumber: magicBoxError.orderNumber },
    });
  }

  // Magic Box integrity guard. A magic_box is a configured line — the parent
  // MUST have picked its per-component sizes/colours before it can enter the
  // cart. Without them the box would still check out at its fixed price with
  // NO record of what was selected (the root cause of ~1,687 historical orders
  // whose order_items.bundle_selections was null). Reject the add outright so
  // an empty-selection magic box can never reach the cart — nor an order.
  {
    const [mb] = await db
      .select({ kind: products.kind })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, body.variantId))
      .limit(1);
    if (
      mb?.kind === "magic_box" &&
      (!body.bundleSelections || body.bundleSelections.length === 0)
    ) {
      return failJson({
        parentId: me.id, studentId: active.id, req, status: 400,
        message:
          "Please configure your Magic Box (sizes & colours) before adding it to the cart.",
        kind: "rule.block",
        details: { rule: "magicbox_no_selection", variantId: body.variantId },
      });
    }
  }

  // Grade-mismatch guard. The cart's grade-mismatch sweep is non-destructive
  // by policy (lib/repos/cart.ts:466-480) — it only HIDES wrong-grade lines
  // from the active sibling's view but leaves them in cart_items. At
  // checkout the per-student grouping then ships them into a real order
  // (root cause for SAL-ORD-2026-30077 / -30167, where a Grade 1 / Grade 11
  // box landed on a Nursery / Grade 8 sibling's order). Refuse at write
  // time so the wrong row never enters cart_items in the first place.
  //
  // Universal products (no product_grades rows) pass through, matching
  // filterProductsByGrade()'s semantics in lib/grade-filter.ts.
  const activeGrade = normalizeGrade(active.grade ?? null);
  if (activeGrade) {
    const variantRow = await db
      .select({ productId: productVariants.productId })
      .from(productVariants)
      .where(eq(productVariants.id, body.variantId))
      .limit(1);
    const productId = variantRow[0]?.productId;
    if (productId) {
      const gradeRows = await db
        .select({ grade: productGrades.grade })
        .from(productGrades)
        .where(eq(productGrades.productId, productId));
      if (gradeRows.length > 0) {
        const allowed = new Set(
          gradeRows.map((r) => normalizeGrade(r.grade) ?? r.grade)
        );
        if (!allowed.has(activeGrade)) {
          return NextResponse.json(
            {
              error: `This item isn't available for ${active.grade}. Please switch to the right child before adding.`,
            },
            { status: 409 }
          );
        }
      }
    }
  }

  await addToCart(
    me.id,
    body.variantId,
    body.qty,
    body.bundleSelections,
    active.id,
    bookkit.capToOne
  );
  const cart = await readCart(
    me.id,
    schoolId,
    active.grade ?? null,
    active.schoolGivenGrade ?? active.grade ?? null,
    allSiblingSchoolIds(me),
    active.id
  );
  return NextResponse.json(cart);
}

const PatchBody = z.object({
  variantId: z.string().uuid(),
  qty: z.number().int().min(0).max(20),
  studentId: z.string().uuid().optional(),
});

export async function PATCH(req: Request) {
  const me = await requireParent();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await parseJson(req, PatchBody);
  if (body instanceof NextResponse) return body;

  // qty=0 is a delete keyed by variantId and is student-agnostic, so the
  // strict guard only applies to writes that increase qty. The read after
  // still uses resolveActive's silent fallback for scoping the snapshot.
  let active: ReturnType<typeof resolveActive>;
  if (body.qty > 0) {
    const guard = requireActiveStudent(me, body.studentId);
    if (!guard.ok) {
      return failJson({
        parentId: me.id, req, status: 400, message: guard.error,
        details: { studentId: body.studentId ?? null }, kind: "rule.block",
      });
    }
    active = guard.student;
    const bookkit = await checkBookkitLimit(me.id, active.id, active.school.id, body.variantId, body.qty);
    if (bookkit.block) {
      return failJson({
        parentId: me.id, studentId: active.id, req, status: 409,
        message: bookkit.block.message, kind: "rule.block",
        details: { rule: "bookkit_limit", variantId: body.variantId, qty: body.qty, op: "patch", orderNumber: bookkit.block.orderNumber },
      });
    }
    const magicBoxError = await checkMagicBoxLimit(me.id, active.id, body.variantId, body.qty);
    if (magicBoxError) {
      return failJson({
        parentId: me.id, studentId: active.id, req, status: 409,
        message: magicBoxError.message, kind: "rule.block",
        details: { rule: "magicbox_limit", variantId: body.variantId, qty: body.qty, op: "patch", orderNumber: magicBoxError.orderNumber },
      });
    }
  } else {
    active = resolveActive(me, body.studentId);
  }
  const schoolId = active?.school.id;

  await setCartQty(me.id, body.variantId, body.qty);
  const cart = await readCart(
    me.id,
    schoolId,
    active?.grade ?? null,
    active?.schoolGivenGrade ?? active?.grade ?? null,
    allSiblingSchoolIds(me),
    active?.id ?? null
  );
  return NextResponse.json(cart);
}

export async function DELETE() {
  const me = await requireParent();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearCart(me.id);
  return NextResponse.json({ ok: true });
}
