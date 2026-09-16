import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { bins, productVariants, products, warehouses } from "@/db/schema";
import {
  PageHeader,
  Card,
  CardHeader,
  Stat,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { Boxes, AlertTriangle } from "lucide-react";
import { GroundStockSyncCard } from "@/components/admin/GroundStockSyncCard";

export const dynamic = "force-dynamic";

export default async function StockReport() {
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
    .limit(50);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "Stock" },
        ]}
        title="Stock report"
        description="Stock health snapshot — units, valuation, and below-min alerts."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="SKUs tracked" value={Number(totals?.skuCount ?? 0)} iconTone="default" />
        <Stat label="Units on hand" value={Number(totals?.totalActual ?? 0).toLocaleString("en-IN")} iconTone="success" />
        <Stat label="Units reserved" value={Number(totals?.totalReserved ?? 0).toLocaleString("en-IN")} iconTone="info" />
        <Stat label="Inventory value" value={<Money paise={Number(totals?.totalValue ?? 0)} />} iconTone="brand" />
      </div>

      <div className="mb-6">
        <GroundStockSyncCard />
      </div>

      <Card padded={false}>
        <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
          <CardHeader title="Below-min-level alerts" description={`${lowStock.length} SKUs need restocking`} />
        </div>
        {lowStock.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Stock is healthy"
            description="No SKUs are below their minimum level."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Size</Th>
                <Th>SKU</Th>
                <Th right>Actual</Th>
                <Th right>Reserved</Th>
                <Th right>Min</Th>
                <Th right>Available</Th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((r, i) => {
                const av = r.actualQty - r.reservedQty;
                const isNeg = av < 0;
                return (
                  <Tr key={i} className={isNeg ? "bg-red-50/40" : "bg-amber-50/30"}>
                    <Td>{r.productName}</Td>
                    <Td muted>{r.size}</Td>
                    <Td>
                      <span className="font-mono text-[12px]">{r.sku}</span>
                    </Td>
                    <Td right>{r.actualQty}</Td>
                    <Td right muted>
                      {r.reservedQty}
                    </Td>
                    <Td right muted>
                      {r.minStockLevel}
                    </Td>
                    <Td right>
                      <Badge tone={isNeg ? "danger" : "warning"} dot size="sm">
                        {av}
                      </Badge>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
