import { NextResponse } from "next/server";
import { sql, gte, and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, shipments } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";

export async function GET(req: Request) {
  const guard = await requirePermission("reports.read");
  if (isResponse(guard)) return guard;
  const url = new URL(req.url);
  const sinceDays = parseInt(url.searchParams.get("days") ?? "30", 10);
  const since = new Date(Date.now() - sinceDays * 86400_000);

  const orderConds = [gte(orders.createdAt, since)];
  if (guard.role === "school_admin") {
    if (!guard.schoolId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    orderConds.push(eq(orders.schoolId, guard.schoolId));
  }

  const [statusDist] = await db
    .select({
      placed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'placed')::int`,
      confirmed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'confirmed')::int`,
      packed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'packed')::int`,
      shipped: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'shipped')::int`,
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'delivered')::int`,
      cancelled: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'cancelled')::int`,
      returned: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'returned')::int`,
    })
    .from(orders)
    .where(and(...orderConds));

  const [cycleTime] = await db
    .select({
      avgConfirmHours: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.confirmedAt} - ${orders.placedAt})) / 3600)`,
      avgShipHours: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.shippedAt} - ${orders.confirmedAt})) / 3600)`,
      avgDeliveryHours: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.deliveredAt} - ${orders.shippedAt})) / 3600)`,
    })
    .from(orders)
    .where(and(...orderConds, sql`${orders.deliveredAt} IS NOT NULL`));

  // Shipments scoped via the join to orders for school_admin.
  const shipConds = [gte(shipments.createdAt, since)];
  if (guard.role === "school_admin" && guard.schoolId) {
    shipConds.push(eq(orders.schoolId, guard.schoolId));
  }
  const [shipDist] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      drafts: sql<number>`COUNT(*) FILTER (WHERE ${shipments.statusEnum} = 'draft')::int`,
      shipped: sql<number>`COUNT(*) FILTER (WHERE ${shipments.statusEnum} = 'shipped')::int`,
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${shipments.statusEnum} = 'delivered')::int`,
    })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .where(and(...shipConds));

  return NextResponse.json({
    sinceDays,
    orderStatus: statusDist,
    shipmentStatus: shipDist,
    cycleTimeHours: {
      placedToConfirmed: Number(cycleTime?.avgConfirmHours ?? 0).toFixed(1),
      confirmedToShipped: Number(cycleTime?.avgShipHours ?? 0).toFixed(1),
      shippedToDelivered: Number(cycleTime?.avgDeliveryHours ?? 0).toFixed(1),
    },
  });
}
