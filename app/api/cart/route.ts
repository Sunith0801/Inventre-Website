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
  schools,
} from "@/db/schema";
import { normalizeGrade } from "@/lib/grade-filter";

// Schools where free (0-price) bookkits are limited to 1 per student ever.
const FREE_BOOKKIT_RESTRICTED_SCHOOL_CODES = ["SMSAW"];
import { getCurrentParent, type CurrentParent } from "@/lib/session";
import { readCart, addToCart, setCartQty, clearCart } from "@/lib/repos/cart";
import { failJson } from "@/lib/observability/fail-json";
import { parseJson } from "@/lib/api-handler";

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
 * and add a Nursery box later. Cancelled orders DO NOT burn the
 * quota (the box never reached the family).
 *
 * Returns the error string if the add should be blocked, null otherwise.
 */
async function checkMagicBoxLimit(
  parentId: string,
  studentId: string | null,
  variantId: string,
  qty: number,
): Promise<string | null> {
  if (!studentId) return null;

  const [variantRow] = await db
    .select({ kind: products.kind })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, variantId))
    .limit(1);
  if (variantRow?.kind !== "magic_box") return null;

  if (qty > 1) {
    return "Only 1 Magic Box can be added per student.";
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
      return "A Magic Box is already in your cart for this student. Only 1 Magic Box per student is allowed.";
    }
  }

  // Order history side: any non-cancelled past order for this student
  // that contains a magic_box line. Paid or ₹0, doesn't matter.
  const priorMagicBoxes = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(orders.parentId, parentId),
        eq(orders.studentId, studentId),
        eq(products.kind, "magic_box"),
        ne(orders.status, "cancelled"),
      ),
    )
    .limit(1);
  if (priorMagicBoxes.length > 0) {
    return "A Magic Box has already been placed for this student. Only 1 Magic Box per student is allowed.";
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
async function checkBookkitLimit(
  parentId: string,
  studentId: string | null,
  schoolId: string | undefined,
  variantId: string,
  qty: number
): Promise<string | null> {
  if (!schoolId) return null;

  // Run school check + variant lookup + cart + order lookups in parallel.
  // The prior-orders lookup is scoped to (parentId, studentId) so siblings
  // are not penalised for each other's redemptions — the error message
  // promises "per student", which is what we now enforce. When studentId
  // is null (legacy session) we skip the order lookup entirely; the cart
  // gate below still runs.
  const activeStatuses = ["placed", "confirmed", "packed", "shipped", "delivered"] as const;
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
      ? db.select({ id: orders.id }).from(orders).where(and(
          eq(orders.parentId, parentId),
          eq(orders.studentId, studentId),
          inArray(orders.status, activeStatuses),
        ))
      : Promise.resolve([] as { id: string }[]),
  ]);

  if (!FREE_BOOKKIT_RESTRICTED_SCHOOL_CODES.includes(schoolRow[0]?.schoolCode ?? "")) return null;

  const variant = variantRow[0];
  const isBookkit = /bookkit|bookset/i.test(variant?.productName ?? "");
  if (!isBookkit) return null;

  // Resolve price (school override takes priority)
  let price = variant.basePrice ?? 0;
  const [schoolOverride] = await db
    .select({ overridePrice: productSchool.overridePrice })
    .from(productSchool)
    .where(and(eq(productSchool.productId, variant.productId), eq(productSchool.schoolId, schoolId)))
    .limit(1);
  if (schoolOverride?.overridePrice !== null && schoolOverride?.overridePrice !== undefined) {
    price = schoolOverride.overridePrice;
  }
  if (price !== 0) return null; // only restrict free bookkits

  if (qty > 1) return "Only 1 complimentary bookkit can be added — it is a free item.";

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
              or(ilike(products.name, "%bookkit%"), ilike(products.name, "%bookset%")),
              ne(cartItems.variantId, variantId)
            )
          )
      : Promise.resolve([]),
    orderIds.length > 0
      ? db
          .select({ id: orderItems.id })
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
      : Promise.resolve([]),
  ]);

  if (cartBookkits.length > 0) {
    return "A complimentary bookkit is already in your cart. Only 1 is allowed per order.";
  }
  if (bookkitInOrders.length > 0) {
    return "You have already received a complimentary bookkit in a previous order. Only 1 is allowed per student.";
  }

  return null;
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

  const bookkitError = await checkBookkitLimit(me.id, active.id, schoolId, body.variantId, body.qty);
  if (bookkitError) {
    return failJson({
      parentId: me.id, studentId: active.id, req, status: 409,
      message: bookkitError, kind: "rule.block",
      details: { rule: "bookkit_limit", variantId: body.variantId, qty: body.qty },
    });
  }

  const magicBoxError = await checkMagicBoxLimit(me.id, active.id, body.variantId, body.qty);
  if (magicBoxError) {
    return failJson({
      parentId: me.id, studentId: active.id, req, status: 409,
      message: magicBoxError, kind: "rule.block",
      details: { rule: "magicbox_limit", variantId: body.variantId, qty: body.qty },
    });
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
    active.id
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
    const bookkitError = await checkBookkitLimit(me.id, active.id, active.school.id, body.variantId, body.qty);
    if (bookkitError) {
      return failJson({
        parentId: me.id, studentId: active.id, req, status: 409,
        message: bookkitError, kind: "rule.block",
        details: { rule: "bookkit_limit", variantId: body.variantId, qty: body.qty, op: "patch" },
      });
    }
    const magicBoxError = await checkMagicBoxLimit(me.id, active.id, body.variantId, body.qty);
    if (magicBoxError) {
      return failJson({
        parentId: me.id, studentId: active.id, req, status: 409,
        message: magicBoxError, kind: "rule.block",
        details: { rule: "magicbox_limit", variantId: body.variantId, qty: body.qty, op: "patch" },
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
