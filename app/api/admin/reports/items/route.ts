import { NextResponse } from "next/server";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  productVariants,
  products,
} from "@/db/schema";
import { isResponse, requirePermission } from "@/lib/admin-guard";

export async function GET(req: Request) {
  const guard = await requirePermission("reports.read");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = url.searchParams.get("format");
  if (!from || !to)
    return NextResponse.json(
      { error: "from and to dates required" },
      { status: 400 }
    );

  const rows = await db
    .select({
      productName: products.name,
      itemCode: products.itemCode,
      sku: productVariants.sku,
      size: productVariants.size,
      qty: sql<number>`COALESCE(SUM(${orderItems.qty}), 0)::int`,
      revenue: sql<number>`COALESCE(SUM(${orderItems.total}), 0)::bigint`,
      orderCount: sql<number>`COUNT(DISTINCT ${orders.id})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        gte(sql`${orders.createdAt}::date`, from),
        lte(sql`${orders.createdAt}::date`, to),
        sql`${orders.paymentStatus} = 'paid'`,
        sql`${orders.status} NOT IN ('cancelled', 'returned')`
      )
    )
    .groupBy(products.name, products.itemCode, productVariants.sku, productVariants.size)
    .orderBy(desc(sql`SUM(${orderItems.total})`));

  if (format === "csv") {
    const header = "Product,Item code,Size,SKU,Orders,Qty,Revenue (paise)\n";
    const body = rows
      .map(
        (r) =>
          `${escape(r.productName)},${r.itemCode ?? ""},${r.size},${r.sku},${r.orderCount},${r.qty},${r.revenue}`
      )
      .join("\n");
    return new NextResponse(header + body, {
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename="items-${from}-${to}.csv"`,
      },
    });
  }
  return NextResponse.json({ from, to, rows });
}

function escape(s: string): string {
  if (s.includes(",") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
