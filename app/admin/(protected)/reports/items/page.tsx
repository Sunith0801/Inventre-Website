import { db } from "@/db/client";
import {
  orders,
  orderItems,
  productVariants,
  products,
} from "@/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { Package, Download } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  EmptyState,
  Stat,
  Money,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ItemSalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const defaultTo = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  const fromDate = from || defaultFrom;
  const toDate = to || defaultTo;

  const rows = await db
    .select({
      productId: products.id,
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
        gte(sql`${orders.createdAt}::date`, fromDate),
        lte(sql`${orders.createdAt}::date`, toDate),
        sql`${orders.paymentStatus} = 'paid'`,
        sql`${orders.status} NOT IN ('cancelled', 'returned')`
      )
    )
    .groupBy(
      products.id,
      products.name,
      products.itemCode,
      productVariants.sku,
      productVariants.size
    )
    .orderBy(desc(sql`SUM(${orderItems.total})`))
    .limit(500);

  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue), 0);
  const totalQty = rows.reduce((s, r) => s + Number(r.qty), 0);
  const uniqueProducts = new Set(rows.map((r) => r.productId)).size;

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "Item-wise sales" },
        ]}
        eyebrow="Reports"
        title="Item-wise sales"
        description="Top-selling SKUs by revenue across paid, non-cancelled orders."
        actions={
          <a
            href={`/api/admin/reports/items?from=${fromDate}&to=${toDate}&format=csv`}
            download
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
        }
      />

      <form
        method="GET"
        className="mb-5 flex flex-wrap gap-2 items-end p-3 bg-white border border-ink-100/70 rounded-xl"
      >
        <DateField label="From" name="from" defaultValue={fromDate} />
        <DateField label="To" name="to" defaultValue={toDate} />
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
        >
          Apply
        </button>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="SKUs sold" value={rows.length} iconTone="default" />
        <Stat
          label="Distinct products"
          value={uniqueProducts}
          iconTone="info"
        />
        <Stat
          label="Total qty"
          value={totalQty.toLocaleString("en-IN")}
          iconTone="success"
        />
        <Stat
          label="Total revenue"
          value={<Money paise={totalRevenue} />}
          iconTone="brand"
        />
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No sales in this range"
            description="Adjust the date filter."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Item code</Th>
                <Th>Size</Th>
                <Th>SKU</Th>
                <Th right>Orders</Th>
                <Th right>Qty</Th>
                <Th right>Revenue</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Tr key={i}>
                  <Td>
                    <span className="font-medium">{r.productName}</span>
                  </Td>
                  <Td muted>
                    <span className="font-mono text-[12px]">
                      {r.itemCode ?? "—"}
                    </span>
                  </Td>
                  <Td muted>{r.size}</Td>
                  <Td>
                    <span className="font-mono text-[12px] text-ink-700">
                      {r.sku}
                    </span>
                  </Td>
                  <Td right>{Number(r.orderCount)}</Td>
                  <Td right>{Number(r.qty)}</Td>
                  <Td right>
                    <Money paise={Number(r.revenue)} className="font-semibold" />
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

function DateField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-ink-700 uppercase tracking-wider">
        {label}
      </label>
      <input
        type="date"
        name={name}
        defaultValue={defaultValue}
        className="block mt-1 h-9 px-3 text-[13px] rounded-lg bg-cream-50 border border-ink-100"
      />
    </div>
  );
}
