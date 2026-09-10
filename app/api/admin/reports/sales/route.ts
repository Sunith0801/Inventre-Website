import { NextResponse } from "next/server";
import { sql, gte, lte, and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, schools } from "@/db/schema";
import { isResponse, requirePermission } from "@/server/admin-guard";

/**
 * Sales report — aggregates by school × period.
 * Query params:
 *   ?from=2026-01-01  &to=2026-12-31  &groupBy=school|day|month
 */
export async function GET(req: Request) {
  const guard = await requirePermission("reports.read");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const groupBy = url.searchParams.get("groupBy") ?? "school";

  const conds = [];
  if (from) conds.push(gte(orders.createdAt, new Date(from)));
  if (to) conds.push(lte(orders.createdAt, new Date(to)));
  conds.push(sql`${orders.paymentStatus} = 'paid'`);
  if (guard.role === "school_admin" && guard.schoolId) {
    conds.push(eq(orders.schoolId, guard.schoolId));
  }

  if (groupBy === "school") {
    const rows = await db
      .select({
        schoolId: schools.id,
        schoolName: schools.name,
        orderCount: sql<number>`COUNT(${orders.id})::int`,
        totalRevenue: sql<number>`COALESCE(SUM(${orders.total}), 0)::bigint`,
        totalUnits: sql<number>`COALESCE((SELECT SUM(qty) FROM order_items WHERE order_items.order_id = ANY(ARRAY_AGG(${orders.id}))), 0)::int`,
      })
      .from(orders)
      .innerJoin(schools, eq(schools.id, orders.schoolId))
      .where(and(...conds))
      .groupBy(schools.id, schools.name)
      .orderBy(sql`SUM(${orders.total}) DESC`);
    return NextResponse.json({ groupBy, rows });
  }

  if (groupBy === "day") {
    const rows = await db
      .select({
        day: sql<string>`TO_CHAR(${orders.createdAt}::date, 'YYYY-MM-DD')`,
        orderCount: sql<number>`COUNT(${orders.id})::int`,
        totalRevenue: sql<number>`COALESCE(SUM(${orders.total}), 0)::bigint`,
      })
      .from(orders)
      .where(and(...conds))
      .groupBy(sql`${orders.createdAt}::date`)
      .orderBy(sql`${orders.createdAt}::date ASC`);
    return NextResponse.json({ groupBy, rows });
  }

  if (groupBy === "month") {
    const rows = await db
      .select({
        month: sql<string>`TO_CHAR(${orders.createdAt}, 'YYYY-MM')`,
        orderCount: sql<number>`COUNT(${orders.id})::int`,
        totalRevenue: sql<number>`COALESCE(SUM(${orders.total}), 0)::bigint`,
      })
      .from(orders)
      .where(and(...conds))
      .groupBy(sql`TO_CHAR(${orders.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${orders.createdAt}, 'YYYY-MM') ASC`);
    return NextResponse.json({ groupBy, rows });
  }

  return NextResponse.json({ error: "unknown groupBy" }, { status: 400 });
}
