import { NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { returns, orders, parents } from "@/db/schema";
import { requirePermission, isResponse } from "@/server/admin-guard";

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
