import { NextResponse } from "next/server";
import { sql, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { parents, orders } from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";

export async function GET() {
  const guard = await requirePermission("reports.read");
  if (isResponse(guard)) return guard;

  const [summary] = await db
    .select({
      totalCustomers: sql<number>`COUNT(*)::int`,
      avgLTV: sql<number>`COALESCE(AVG(${parents.totalLifetimeValue}), 0)::bigint`,
      activeCustomers: sql<number>`COUNT(*) FILTER (WHERE ${parents.totalOrderCount} > 0)::int`,
    })
    .from(parents);

  const top = await db
    .select({
      id: parents.id,
      name: parents.name,
      phone: parents.phone,
      orderCount: parents.totalOrderCount,
      lifetimeValue: parents.totalLifetimeValue,
      lastOrderAt: parents.lastOrderAt,
    })
    .from(parents)
    .orderBy(desc(parents.totalLifetimeValue))
    .limit(50);

  const newRows = await db
    .select({
      day: sql<string>`TO_CHAR(${parents.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(parents)
    .where(sql`${parents.createdAt} > NOW() - INTERVAL '30 days'`)
    .groupBy(sql`${parents.createdAt}::date`)
    .orderBy(sql`${parents.createdAt}::date ASC`);

  return NextResponse.json({
    summary: {
      totalCustomers: Number(summary?.totalCustomers ?? 0),
      activeCustomers: Number(summary?.activeCustomers ?? 0),
      avgLifetimeValuePaise: Number(summary?.avgLTV ?? 0),
    },
    topCustomers: top,
    newSignupsByDay: newRows,
  });
}
