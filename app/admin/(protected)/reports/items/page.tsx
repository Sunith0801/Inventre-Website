import Link from "next/link";
import { db } from "@/db/client";
import { orders, orderItems, productVariants, products } from "@/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { Package, Download } from "lucide-react";
import { PageHeader, Th, Td, Tr, EmptyState, Stat, Money } from "@/components/admin/ui/primitives";
import { ReportToolbar, reportRange } from "@/components/admin/reports/ReportToolbar";
import { ReportTable, DownloadLink } from "@/components/admin/reports/ReportTable";

export const dynamic = "force-dynamic";

const ROW_LIMIT = 500;

export default async function ItemSalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { from: fromDate, to: toDate } = reportRange(sp);

  // Indian calendar days (the DB session is UTC; see the Sales report).
  const istDay = sql`(${orders.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`;
  const where = and(
    gte(istDay, fromDate),
    lte(istDay, toDate),
    sql`${orders.paymentStatus} = 'paid'`,
    sql`${orders.status} NOT IN ('cancelled', 'returned')`
  );

  const [rows, [totals]] = await Promise.all([
    db
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
      .where(where)
      .groupBy(products.id, products.name, products.itemCode, productVariants.sku, productVariants.size)
      .orderBy(desc(sql`SUM(${orderItems.total})`))
      .limit(ROW_LIMIT),
    // Totals over EVERY matching line. They used to be summed from the rows
    // on screen, so they understated the range whenever it had >500 SKUs.
    db
      .select({
        skus: sql<number>`COUNT(DISTINCT ${productVariants.id})::int`,
        products: sql<number>`COUNT(DISTINCT ${products.id})::int`,
        qty: sql<number>`COALESCE(SUM(${orderItems.qty}), 0)::bigint`,
        revenue: sql<number>`COALESCE(SUM(${orderItems.total}), 0)::bigint`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where),
  ]);

  const skuCount = Number(totals?.skus ?? 0);
  const capped = skuCount > rows.length;

  return (
    <div>
      <PageHeader
        eyebrow="Overview & Analytics"
        breadcrumb={[{ label: "Reports", href: "/admin/reports" }, { label: "Item-wise sales" }]}
        title="Item-wise sales"
        actions={
          <DownloadLink href={`/api/admin/reports/items?from=${fromDate}&to=${toDate}&format=csv`}>
            <Download className="h-3.5 w-3.5" /> CSV
          </DownloadLink>
        }
      />

      <ReportToolbar action="/admin/reports/items" from={fromDate} to={toDate} requested={sp} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="SKUs sold" value={skuCount.toLocaleString("en-IN")} />
        <Stat label="Products" value={Number(totals?.products ?? 0).toLocaleString("en-IN")} />
        <Stat label="Units" value={Number(totals?.qty ?? 0).toLocaleString("en-IN")} />
        <Stat label="Revenue" value={<Money paise={Number(totals?.revenue ?? 0)} />} />
      </div>

      <ReportTable
        title="Top-selling SKUs"
        description={
          capped
            ? `Top ${rows.length.toLocaleString("en-IN")} of ${skuCount.toLocaleString("en-IN")} SKUs by revenue · the CSV has every SKU`
            : "Paid orders in the range, highest revenue first"
        }
      >
        {rows.length === 0 ? (
          <EmptyState icon={Package} title="No sales in this range" description="Adjust the date filter." />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Item code</Th>
                <Th>Size</Th>
                <Th>SKU</Th>
                <Th right>Orders</Th>
                <Th right>Units</Th>
                <Th right>Revenue</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Tr key={i}>
                  <Td>
                    <Link href={`/admin/products/${r.productId}`} className="hover:text-brand-700">
                      {r.productName}
                    </Link>
                  </Td>
                  <Td muted><span className="font-mono text-[12px]">{r.itemCode ?? "—"}</span></Td>
                  <Td muted>{r.size}</Td>
                  <Td muted><span className="font-mono text-[12px]">{r.sku}</span></Td>
                  <Td right muted>{Number(r.orderCount).toLocaleString("en-IN")}</Td>
                  <Td right>{Number(r.qty).toLocaleString("en-IN")}</Td>
                  <Td right><Money paise={Number(r.revenue)} className="font-semibold" /></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportTable>
    </div>
  );
}
