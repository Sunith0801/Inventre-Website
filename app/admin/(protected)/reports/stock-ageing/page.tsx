import { db } from "@/db/client";
import {
  bins,
  productVariants,
  products,
  warehouses,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { Hourglass } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  Stat,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

/**
 * Stock Ageing — bucket on-hand stock by the days since last inbound movement
 * (receipt / return_in / positive adjustment). Items sitting longest are at
 * the top, with bucket totals to identify slow-moving SKUs.
 */
export default async function StockAgeingReportPage() {
  const rows = await db
    .select({
      variantId: bins.variantId,
      warehouseId: bins.warehouseId,
      warehouseName: warehouses.name,
      actualQty: bins.actualQty,
      reservedQty: bins.reservedQty,
      productName: products.name,
      sku: productVariants.sku,
      size: productVariants.size,
      lastInboundAt: sql<Date | null>`(
        SELECT MAX(created_at)
        FROM stock_ledger
        WHERE variant_id = ${bins.variantId}
          AND warehouse_id = ${bins.warehouseId}
          AND delta > 0
      )`.as("last_inbound_at"),
    })
    .from(bins)
    .innerJoin(warehouses, eq(warehouses.id, bins.warehouseId))
    .innerJoin(productVariants, eq(productVariants.id, bins.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(sql`${bins.actualQty} > 0`)
    .orderBy(sql`(
      SELECT MAX(created_at) FROM stock_ledger
      WHERE variant_id = ${bins.variantId}
        AND warehouse_id = ${bins.warehouseId}
        AND delta > 0
    ) ASC NULLS FIRST`);

  const now = Date.now();
  const buckets = { b30: 0, b60: 0, b90: 0, b180: 0, b181: 0 };
  const enriched = rows.map((r) => {
    const d = r.lastInboundAt ? new Date(r.lastInboundAt) : null;
    const days = d ? Math.floor((now - d.getTime()) / 86400_000) : null;
    let bucket: keyof typeof buckets = "b181";
    if (days == null) bucket = "b181";
    else if (days <= 30) bucket = "b30";
    else if (days <= 60) bucket = "b60";
    else if (days <= 90) bucket = "b90";
    else if (days <= 180) bucket = "b180";
    buckets[bucket] += r.actualQty;
    return { ...r, days, bucket };
  });

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "Stock ageing" },
        ]}
        eyebrow="Reports"
        title="Stock ageing"
        description="Days since the last inbound movement (receipt / return_in / +adjust). Older buckets indicate slow-moving SKUs to discount or write down."
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <Stat
          label="0–30 days"
          value={buckets.b30.toLocaleString("en-IN")}
          iconTone="success"
        />
        <Stat
          label="31–60"
          value={buckets.b60.toLocaleString("en-IN")}
          iconTone="info"
        />
        <Stat
          label="61–90"
          value={buckets.b90.toLocaleString("en-IN")}
          iconTone="warning"
        />
        <Stat
          label="91–180"
          value={buckets.b180.toLocaleString("en-IN")}
          iconTone="warning"
        />
        <Stat
          label="180+"
          value={buckets.b181.toLocaleString("en-IN")}
          iconTone="danger"
        />
      </div>

      <Card padded={false}>
        {enriched.length === 0 ? (
          <EmptyState
            icon={Hourglass}
            title="No stock on hand"
            description="When stock is received, it will start aging from that timestamp."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Size</Th>
                <Th>SKU</Th>
                <Th>Warehouse</Th>
                <Th right>On hand</Th>
                <Th right>Days idle</Th>
                <Th>Bucket</Th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((r) => (
                <Tr key={`${r.variantId}-${r.warehouseId}`}>
                  <Td>
                    <span className="font-medium">{r.productName}</span>
                  </Td>
                  <Td muted>{r.size}</Td>
                  <Td>
                    <span className="font-mono text-[12px] text-ink-700">{r.sku}</span>
                  </Td>
                  <Td muted>{r.warehouseName}</Td>
                  <Td right>{r.actualQty}</Td>
                  <Td right>
                    <span className="tabular-nums">
                      {r.days != null ? r.days : "—"}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={bucketTone(r.bucket)} dot size="sm">
                      {bucketLabel(r.bucket)}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function bucketLabel(b: string): string {
  switch (b) {
    case "b30":
      return "0–30";
    case "b60":
      return "31–60";
    case "b90":
      return "61–90";
    case "b180":
      return "91–180";
    default:
      return "180+";
  }
}

function bucketTone(b: string): "success" | "info" | "warning" | "danger" {
  switch (b) {
    case "b30":
      return "success";
    case "b60":
      return "info";
    case "b90":
      return "warning";
    case "b180":
      return "warning";
    default:
      return "danger";
  }
}
