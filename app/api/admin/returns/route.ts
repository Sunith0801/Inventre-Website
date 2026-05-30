import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  returns,
  returnItems,
  orders,
  orderItems,
  parents,
} from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { logActivity } from "@/lib/activity";

export async function GET(req: Request) {
  const guard = await requirePermission("returns.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const id = url.searchParams.get("id");
  const conds = [];
  if (id) conds.push(eq(returns.id, id));
  if (status) conds.push(eq(returns.status, status as never));
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    conds.push(eq(orders.schoolId, guard.schoolId));
  }
  const rows = await db
    .select({
      ret: returns,
      parentName: parents.name,
      parentPhone: parents.phone,
    })
    .from(returns)
    .leftJoin(parents, eq(parents.id, returns.parentId))
    .innerJoin(orders, eq(orders.id, returns.orderId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(returns.createdAt))
    .limit(id ? 1 : 200);
  return NextResponse.json({ returns: rows });
}

const Body = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(1),
  notes: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        variantId: z.string().uuid(),
        qty: z.number().int().min(1),
        condition: z.enum(["unopened", "opened", "damaged"]).optional(),
      })
    )
    .min(1),
});

async function nextReturnNumber(): Promise<string> {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(returns);
  const year = new Date().getFullYear();
  return `RTN-${year}-${String(Number(count) + 1).padStart(5, "0")}`;
}

export async function POST(req: Request) {
  const guard = await requirePermission("returns.write");
  if (isResponse(guard)) return guard;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, body.orderId))
    .limit(1);
  if (!order)
    return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Compute refund amount as sum of (orderItem.unit_price * qty) for the selected lines.
  const selectedLineIds = body.items.map((i) => i.orderItemId);
  const lines = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  const byId = new Map(lines.map((l) => [l.id, l]));
  let refund = 0;
  for (const r of body.items) {
    const line = byId.get(r.orderItemId);
    if (!line) continue;
    const unit = line.qty > 0 ? Math.round(line.total / line.qty) : 0;
    refund += unit * r.qty;
  }

  const returnNumber = await nextReturnNumber();
  const created = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(returns)
      .values({
        returnNumber,
        orderId: order.id,
        parentId: order.parentId,
        reason: body.reason,
        notes: body.notes ?? null,
        refundAmount: refund,
        status: "requested",
        itemIds: selectedLineIds as unknown as never,
      })
      .returning();
    for (const it of body.items) {
      await tx.insert(returnItems).values({
        returnId: r.id,
        orderItemId: it.orderItemId,
        variantId: it.variantId,
        qty: it.qty,
        reason: body.reason,
        condition: it.condition ?? null,
      });
    }
    return r;
  });

  await logActivity({
    actorId: guard.id,
    actorEmail: guard.email,
    action: "return.create",
    entityType: "return",
    entityId: created.id,
    summary: `Return ${returnNumber} requested for order ${order.orderNumber} · ₹${Math.round(refund / 100)}`,
  });

  return NextResponse.json({
    id: created.id,
    returnNumber,
    refundAmount: refund,
  });
}
