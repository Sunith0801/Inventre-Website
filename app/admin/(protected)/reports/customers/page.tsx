import Link from "next/link";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, parents } from "@/db/schema";
import { PageHeader, Stat, Th, Td, Tr, Money, EmptyState } from "@/components/admin/ui/primitives";
import { ReportTable } from "@/components/admin/reports/ReportTable";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Customers by lifetime value, aggregated from paid orders (not the
 * denormalised counters on `parents`, which nothing ever writes).
 */
export default async function CustomersReport() {
  const paid = sql`${orders.paymentStatus} = 'paid'`;

  const [[summary], [activity], top] = await Promise.all([
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        newThisMonth: sql<number>`COUNT(*) FILTER (WHERE ${parents.createdAt} >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::int`,
      })
      .from(parents),
    db
      .select({
        active: sql<number>`COUNT(DISTINCT ${orders.parentId})::int`,
        revenue: sql<number>`COALESCE(SUM(${orders.total}), 0)::bigint`,
      })
      .from(orders)
      .where(paid),
    db
      .select({
        id: parents.id,
        name: parents.name,
        phone: parents.phone,
        orderCount: sql<number>`COUNT(${orders.id})::int`,
        lifetimeValue: sql<number>`COALESCE(SUM(${orders.total}), 0)::bigint`,
        lastOrderAt: sql<Date | null>`MAX(${orders.createdAt})`,
      })
      .from(orders)
      .innerJoin(parents, eq(parents.id, orders.parentId))
      .where(paid)
      .groupBy(parents.id, parents.name, parents.phone)
      .orderBy(sql`SUM(${orders.total}) DESC`, sql`COUNT(${orders.id}) DESC`)
      .limit(50),
  ]);

  const active = Number(activity?.active ?? 0);
  // Whole rupees; stray paise on an average is noise.
  const avgLtv = active ? Math.round(Number(activity?.revenue ?? 0) / active / 100) * 100 : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Overview & Analytics"
        breadcrumb={[{ label: "Reports", href: "/admin/reports" }, { label: "Customers" }]}
        title="Customer report"
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Customers" value={Number(summary?.total ?? 0).toLocaleString("en-IN")} hint="Registered parents" />
        <Stat label="With a paid order" value={active.toLocaleString("en-IN")} />
        <Stat label="New this month" value={Number(summary?.newThisMonth ?? 0).toLocaleString("en-IN")} />
        <Stat label="Average lifetime value" value={<Money paise={avgLtv} />} hint="Per paying customer" />
      </div>

      <ReportTable title="Top customers" description="The 50 highest lifetime values, from paid orders">
        {top.length === 0 ? (
          <EmptyState icon={Users} title="No paid orders yet" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th className="w-10">#</Th>
                <Th>Customer</Th>
                <Th>Phone</Th>
                <Th right>Paid orders</Th>
                <Th right>Lifetime value</Th>
                <Th right>Last order</Th>
              </tr>
            </thead>
            <tbody>
              {top.map((p, i) => (
                <Tr key={p.id}>
                  <Td muted>{i + 1}</Td>
                  <Td>
                    <Link href={`/admin/customers/${p.id}`} className="hover:text-brand-700">
                      {p.name ?? <span className="text-ink-400">No name</span>}
                    </Link>
                  </Td>
                  <Td muted><span className="font-mono text-[12px]">{p.phone}</span></Td>
                  <Td right muted>{Number(p.orderCount).toLocaleString("en-IN")}</Td>
                  <Td right><Money paise={Number(p.lifetimeValue)} className="font-semibold" /></Td>
                  <Td right muted className="whitespace-nowrap">
                    {p.lastOrderAt
                      ? new Date(p.lastOrderAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })
                      : "—"}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportTable>
    </div>
  );
}
