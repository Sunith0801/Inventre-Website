import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  reviews,
  orders,
  orderItems,
  productVariants,
  products,
} from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";
import { invalidate } from "@/lib/cache";

const Body = z.object({
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().min(10).max(2000),
});

export async function POST(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;

  let payload;
  try {
    payload = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Verified buyer? — does this parent have a delivered order with this product?
  const [hit] = await db
    .select({ orderId: orders.id })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(orders.parentId, me.id),
        eq(products.id, payload.productId),
        eq(orders.status, "delivered")
      )
    )
    .limit(1);

  // Allow non-verified reviews too, just don't mark verified.
  const verifiedPurchase = !!hit;

  // One review per parent per product
  const [existing] = await db
    .select()
    .from(reviews)
    .where(
      and(eq(reviews.parentId, me.id), eq(reviews.productId, payload.productId))
    )
    .limit(1);
  if (existing) {
    return NextResponse.json(
      {
        error:
          "You've already reviewed this product. Edit feature coming soon.",
      },
      { status: 409 }
    );
  }

  const [created] = await db
    .insert(reviews)
    .values({
      productId: payload.productId,
      parentId: me.id,
      orderId: hit?.orderId ?? null,
      rating: payload.rating,
      body: payload.body,
      status: "pending",
      verifiedPurchase,
    })
    .returning();

  // bust the product cache so admin sees pending count update
  await invalidate("admin:reviews:pending");

  return NextResponse.json({
    review: { id: created.id, status: created.status, verifiedPurchase },
  });
}
