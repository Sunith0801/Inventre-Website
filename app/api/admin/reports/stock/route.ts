import { NextResponse } from "next/server";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { bins, productVariants, products, warehouses } from "@/db/schema";
import { requireAdmin, isResponse } from "@/lib/admin-guard";

/**
 * Stock valuation + low-stock report.
 * Returns: total stock value (paise), low-stock count, slow-moving items.
 */
export async function GET() {
  // Bins/warehouses are global — not scoped to a school.
  // school_admin has no business reading cross-tenant inventory totals.
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;

  const [totals] = await db
    .select({
      skuCount: sql<number>`COUNT(DISTINCT ${bins.variantId})::int`,
      totalActual: sql<number>`COALESCE(SUM(${bins.actualQty}), 0)::bigint`,
      totalReserved: sql<number>`COALESCE(SUM(${bins.reservedQty}), 0)::bigint`,
      totalValue: sql<number>`COALESCE(SUM(${bins.actualQty} * ${bins.valuationRate}), 0)::bigint`,
    })
    .from(bins);

  const lowStock = await db
    .select({
      variantId: bins.variantId,
      productName: products.name,
      sku: productVariants.sku,
      size: productVariants.size,
      warehouseName: warehouses.name,
      actualQty: bins.actualQty,
      reservedQty: bins.reservedQty,
      minStockLevel: bins.minStockLevel,
    })
    .from(bins)
    .innerJoin(productVariants, eq(productVariants.id, bins.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(warehouses, eq(warehouses.id, bins.warehouseId))
    .where(sql`${bins.actualQty} - ${bins.reservedQty} <= ${bins.minStockLevel}`)
    .limit(100);

  const negative = await db
    .select({
      variantId: bins.variantId,
      productName: products.name,
      sku: productVariants.sku,
      size: productVariants.size,
      actualQty: bins.actualQty,
      reservedQty: bins.reservedQty,
    })
    .from(bins)
    .innerJoin(productVariants, eq(productVariants.id, bins.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(sql`${bins.actualQty} - ${bins.reservedQty} < 0`);

  return NextResponse.json({
    summary: {
      skuCount: Number(totals?.skuCount ?? 0),
      totalActual: Number(totals?.totalActual ?? 0),
      totalReserved: Number(totals?.totalReserved ?? 0),
      totalValuePaise: Number(totals?.totalValue ?? 0),
    },
    lowStock,
    negativeStock: negative,
  });
}
