import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, ne, inArray, ilike, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  products,
  productVariants,
  productSchool,
  carts,
  cartItems,
  orders,
  orderItems,
  schools,
} from "@/db/schema";

// Schools where free (0-price) bookkits are limited to 1 per student ever.
const FREE_BOOKKIT_RESTRICTED_SCHOOL_CODES = ["SMSAW"];
import { getCurrentParent, type CurrentParent } from "@/lib/session";
import { readCart, addToCart, setCartQty, clearCart } from "@/lib/repos/cart";
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

  const active = resolveActive(me, body.studentId);
  const schoolId = active?.school.id;

  const bookkitError = await checkBookkitLimit(me.id, active?.id ?? null, schoolId, body.variantId, body.qty);
  if (bookkitError) {
    return NextResponse.json({ error: bookkitError }, { status: 409 });
  }

  await addToCart(
    me.id,
    body.variantId,
    body.qty,
    body.bundleSelections,
    active?.id ?? null
  );
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

  const active = resolveActive(me, body.studentId);
  const schoolId = active?.school.id;

  // Only check if increasing qty (qty=0 means remove, which is always fine)
  if (body.qty > 0) {
    const bookkitError = await checkBookkitLimit(me.id, active?.id ?? null, schoolId, body.variantId, body.qty);
    if (bookkitError) {
      return NextResponse.json({ error: bookkitError }, { status: 409 });
    }
  }

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
