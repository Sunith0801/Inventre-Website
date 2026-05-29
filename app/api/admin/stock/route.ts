import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  bins,
  warehouses,
  productVariants,
  products,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { listLowStock } from "@/lib/repos/inventory";

export async function GET(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const lowOnly = url.searchParams.get("lowOnly") === "1";

  if (lowOnly) {
    const rows = await listLowStock();
    return NextResponse.json({ rows });
  }

  const rows = await db
    .select({
      variantId: bins.variantId,
      warehouseId: bins.warehouseId,
      warehouseName: warehouses.name,
      actualQty: bins.actualQty,
      reservedQty: bins.reservedQty,
      minStockLevel: bins.minStockLevel,
      productName: products.name,
      productSlug: products.slug,
      size: productVariants.size,
      sku: productVariants.sku,
    })
    .from(bins)
    .innerJoin(warehouses, eq(warehouses.id, bins.warehouseId))
    .innerJoin(productVariants, eq(productVariants.id, bins.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .orderBy(sql`${products.name} ASC, ${productVariants.size} ASC`);

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      available: r.actualQty - r.reservedQty,
    })),
  });
}
