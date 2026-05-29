import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { returns, returnItems, orders, orderItems } from "@/db/schema";
import { requireParent, isResponse } from "@/lib/parent-guard";
import { allocReturnNumber } from "@/lib/numbering";

const Body = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(1),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        qty: z.number().int().min(1),
        condition: z.enum(["unopened", "opened", "damaged"]).optional(),
      })
    )
    .min(1),
});

export async function GET() {
  const me = await requireParent();
  if (isResponse(me)) return me;
  const rows = await db
    .select()
    .from(returns)
    .where(eq(returns.parentId, me.id))
    .orderBy(desc(returns.createdAt));
  return NextResponse.json({ returns: rows });
}

export async function POST(req: Request) {
  const me = await requireParent();
  if (isResponse(me)) return me;

  const body = Body.parse(await req.json());

  // Single scoped query — no enumeration possible: if this orderId doesn't
  // belong to me, no row comes back.
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, body.orderId), eq(orders.parentId, me.id)))
    .limit(1);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "delivered") {
    return NextResponse.json(
      { error: "Returns are only allowed for delivered orders" },
      { status: 400 }
    );
  }

  // Validate order items — uses inArray (drizzle's array IN helper). The
  // previous `sql\`… IN ${arr}\`` form did not bind arrays correctly.
  const orderItemIds = body.items.map((i) => i.orderItemId);
  const itemRows = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.orderId, body.orderId),
        inArray(orderItems.id, orderItemIds)
      )
    );
  if (itemRows.length !== body.items.length) {
    return NextResponse.json({ error: "Invalid item ids" }, { status: 400 });
  }
  const itemById = new Map(itemRows.map((r) => [r.id, r]));

  const returnNumber = await allocReturnNumber();

  const [ret] = await db
    .insert(returns)
    .values({
      orderId: body.orderId,
      parentId: me.id,
      returnNumber,
      reason: body.reason,
      notes: body.notes ?? null,
      status: "requested",
      itemIds: orderItemIds,
    })
    .returning();

  // ERP-imported sub-items can have NULL variant_id (no catalog match);
  // returnItems requires a non-null variant. Reject the whole request
  // rather than silently dropping lines — the caller picked specific
  // items and deserves to know we can't process some of them.
  const unmappedItems = body.items.filter((i) => {
    const oi = itemById.get(i.orderItemId);
    return oi && oi.variantId === null;
  });
  if (unmappedItems.length > 0) {
    return NextResponse.json(
      {
        error:
          "Some items are ERP-imported without a local SKU and can't be returned through this flow.",
        unmappedOrderItemIds: unmappedItems.map((i) => i.orderItemId),
      },
      { status: 400 }
    );
  }
  await db.insert(returnItems).values(
    body.items.map((i) => {
      const oi = itemById.get(i.orderItemId)!;
      return {
        returnId: ret.id,
        orderItemId: i.orderItemId,
        variantId: oi.variantId as string,
        qty: i.qty,
        reason: body.reason,
        condition: i.condition ?? null,
      };
    })
  );

  return NextResponse.json({ id: ret.id, returnNumber });
}
