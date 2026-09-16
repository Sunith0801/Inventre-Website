import { db } from "@/db/client";
import {
  bins,
  productVariants,
  products,
  warehouses,
  purchaseOrderItems,
  purchaseOrders,
} from "@/db/schema";
import { and, eq, sql, inArray } from "drizzle-orm";
import { Boxes, AlertTriangle, Sliders, ClipboardCheck, Shuffle } from "lucide-react";
import Link from "next/link";
import {
  PageHeader,
  Card,
  Toolbar,
  FilterChips,
  Button,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  Stat,
} from "@/components/admin/ui/primitives";
import { ExportButton } from "@/components/admin/ExportButton";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ low?: string }>;
}) {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { low } = await searchParams;
  const onlyLow = low === "1";

  const rows = await db
    .select({
      variantId: bins.variantId,
      warehouseId: bins.warehouseId,
      warehouseName: warehouses.name,
      actualQty: bins.actualQty,
      reservedQty: bins.reservedQty,
      minStockLevel: bins.minStockLevel,
      productName: products.name,
      sku: productVariants.sku,
      size: productVariants.size,
    })
    .from(bins)
    .innerJoin(warehouses, eq(warehouses.id, bins.warehouseId))
    .innerJoin(productVariants, eq(productVariants.id, bins.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(onlyLow ? sql`${bins.actualQty} - ${bins.reservedQty} <= ${bins.minStockLevel}` : undefined)
    .orderBy(sql`${products.name} ASC, ${productVariants.size} ASC`)
    .limit(500);

  // Compute summary stats
  const allRows = onlyLow
    ? rows
    : await db
        .select({
          actualQty: bins.actualQty,
          reservedQty: bins.reservedQty,
          minStockLevel: bins.minStockLevel,
        })
        .from(bins);

  const totalActual = allRows.reduce((s, r) => s + (r.actualQty ?? 0), 0);
  const totalReserved = allRows.reduce((s, r) => s + (r.reservedQty ?? 0), 0);
  const lowCount = allRows.filter(
    (r) => (r.actualQty ?? 0) - (r.reservedQty ?? 0) <= (r.minStockLevel ?? 0)
  ).length;
  const negCount = allRows.filter((r) => (r.actualQty ?? 0) - (r.reservedQty ?? 0) < 0).length;

  // Projected (on-order) qty per variant — open POs (submitted / partially_received).
  const variantIds = Array.from(
    new Set(rows.map((r) => r.variantId).filter((v): v is string => !!v))
  );
  const projectedRows = variantIds.length
    ? await db
        .select({
          variantId: purchaseOrderItems.variantId,
          pending: sql<number>`COALESCE(SUM(${purchaseOrderItems.qty} - ${purchaseOrderItems.receivedQty}), 0)::int`,
        })
        .from(purchaseOrderItems)
        .innerJoin(
          purchaseOrders,
          eq(purchaseOrders.id, purchaseOrderItems.poId)
        )
        // inArray, not `= ANY(${variantIds}::uuid[])`: Drizzle binds a JS array
        // as a record and Postgres refuses the cast (42846). This query only
        // ran once bins existed — the Ground Stock bridge filled them on
        // 2026-09-16 and the page 500'd on first open.
        .where(
          and(
            sql`${purchaseOrders.status} IN ('submitted', 'partially_received')`,
            inArray(purchaseOrderItems.variantId, variantIds)
          )
        )
        .groupBy(purchaseOrderItems.variantId)
    : [];
  const projectedByVariant = new Map<string, number>();
  for (const p of projectedRows) {
    if (p.variantId) projectedByVariant.set(p.variantId, Number(p.pending));
  }
  const totalProjected = Array.from(projectedByVariant.values()).reduce(
    (s, n) => s + n,
    0
  );

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Stock"
        description={`${rows.length} bins shown · live across all warehouses`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <ExportButton type="stock" />
            <Link href="/admin/catalog/stock/ledger">
              <Button variant="secondary">Ledger</Button>
            </Link>
            <Link href="/admin/catalog/stock/transfer">
              <Button
                icon={<Shuffle className="h-3.5 w-3.5" />}
                variant="secondary"
              >
                Transfer
              </Button>
            </Link>
            <Link href="/admin/catalog/stock/reconcile">
              <Button
                icon={<ClipboardCheck className="h-3.5 w-3.5" />}
                variant="secondary"
              >
                Reconcile
              </Button>
            </Link>
            <Link href="/admin/catalog/stock/adjust">
              <Button icon={<Sliders className="h-3.5 w-3.5" />} variant="primary">
                Adjust stock
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <Stat label="Bins tracked" value={allRows.length} iconTone="default" />
        <Stat label="Units on hand" value={totalActual.toLocaleString("en-IN")} iconTone="success" />
        <Stat label="Units reserved" value={totalReserved.toLocaleString("en-IN")} iconTone="info" />
        <Stat
          label="On order"
          value={totalProjected.toLocaleString("en-IN")}
          iconTone="violet"
          hint="From open POs"
        />
        <Stat
          label="Below min level"
          value={lowCount}
          icon={AlertTriangle}
          iconTone={lowCount > 0 ? "warning" : "default"}
          hint={negCount > 0 ? `${negCount} oversold` : undefined}
        />
      </div>

      <Toolbar>
        <FilterChips
          options={[
            { value: null, label: "All bins" },
            { value: "1", label: "Below min level only" },
          ]}
          value={onlyLow ? "1" : null}
          baseHref="/admin/catalog/stock"
          paramName="low"
        />
      </Toolbar>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={onlyLow ? "No low-stock items" : "No bins tracked"}
            description={
              onlyLow
                ? "Stock levels are healthy across all SKUs."
                : "Bins are created automatically when products are added."
            }
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Size</Th>
                <Th>SKU</Th>
                <Th>Warehouse</Th>
                <Th right>Actual</Th>
                <Th right>Reserved</Th>
                <Th right>On order</Th>
                <Th right>Available</Th>
                <Th right>Min</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const available = r.actualQty - r.reservedQty;
                const isLow = available <= r.minStockLevel;
                const isNeg = available < 0;
                return (
                  <Tr
                    key={`${r.variantId}-${r.warehouseId}`}
                    className={isNeg ? "bg-red-50/40" : isLow ? "bg-amber-50/30" : ""}
                  >
                    <Td>
                      <span className="font-medium text-ink-900">{r.productName}</span>
                    </Td>
                    <Td muted>{r.size}</Td>
                    <Td>
                      <span className="font-mono text-[12px] text-ink-700">{r.sku}</span>
                    </Td>
                    <Td muted>{r.warehouseName}</Td>
                    <Td right>{r.actualQty}</Td>
                    <Td right muted>
                      {r.reservedQty}
                    </Td>
                    <Td right muted>
                      {projectedByVariant.get(r.variantId) ? (
                        <span className="text-violet-700 font-medium">
                          +{projectedByVariant.get(r.variantId)}
                        </span>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </Td>
                    <Td right>
                      {isNeg ? (
                        <Badge tone="danger" dot size="sm">
                          {available}
                        </Badge>
                      ) : isLow ? (
                        <Badge tone="warning" dot size="sm">
                          {available}
                        </Badge>
                      ) : (
                        <span className="font-semibold">{available}</span>
                      )}
                    </Td>
                    <Td right muted>
                      {r.minStockLevel}
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
