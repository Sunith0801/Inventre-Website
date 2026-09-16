import Link from "next/link";
import { sql, eq, and, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, schools } from "@/db/schema";
import { PageHeader, Stat, Th, Td, Tr, Money, EmptyState } from "@/components/admin/ui/primitives";
import { ReportToolbar, validDate } from "@/components/admin/reports/ReportToolbar";
import { ReportTable } from "@/components/admin/reports/ReportTable";
import { BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SalesReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  // Blank (or malformed) dates mean open-ended; a reversed range is swapped.
  let from = validDate(sp.from);
  let to = validDate(sp.to);
  if (from && to && from > to) [from, to] = [to, from];

  // Days and months are Indian calendar days. The DB session runs in UTC, so
  // a bare ::date or TO_CHAR filed orders placed 00:00–05:30 IST under the
  // previous day — and under the previous month on the 1st.
  const istDay = sql`(${orders.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`;
  const istMonth = sql<string>`TO_CHAR(${orders.createdAt} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`;

  const conds: SQL[] = [sql`${orders.paymentStatus} = 'paid'`];
  if (from) conds.push(gte(istDay, from));
  if (to) conds.push(lte(istDay, to));
  const where = and(...conds);

  const [bySchool, byMonth] = await Promise.all([
    db
      .select({
        schoolId: schools.id,
        schoolName: schools.name,
        orderCount: sql<number>`COUNT(${orders.id})::int`,
        revenue: sql<number>`COALESCE(SUM(${orders.total}), 0)::bigint`,
      })
      .from(orders)
      .innerJoin(schools, eq(schools.id, orders.schoolId))
      .where(where)
      .groupBy(schools.id, schools.name)
      .orderBy(sql`SUM(${orders.total}) DESC`),
    db
      .select({
        month: istMonth,
        orderCount: sql<number>`COUNT(${orders.id})::int`,
        revenue: sql<number>`COALESCE(SUM(${orders.total}), 0)::bigint`,
      })
      .from(orders)
      .where(where)
      .groupBy(istMonth)
      .orderBy(sql`${istMonth} DESC`),
  ]);

  const totalOrders = byMonth.reduce((s, r) => s + Number(r.orderCount), 0);
  const totalRevenue = byMonth.reduce((s, r) => s + Number(r.revenue), 0);
  // Whole rupees: an average carrying stray paise ("₹5,812.9") is noise.
  const avgOrder = totalOrders ? Math.round(totalRevenue / totalOrders / 100) * 100 : 0;
  const schoolOrders = bySchool.reduce((s, r) => s + Number(r.orderCount), 0);
  const noSchool = totalOrders - schoolOrders;

  return (
    <div>
      <PageHeader
        eyebrow="Overview & Analytics"
        breadcrumb={[{ label: "Reports", href: "/admin/reports" }, { label: "Sales" }]}
        title="Sales report"
      />

      <ReportToolbar action="/admin/reports/sales" from={from} to={to} requested={sp} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Paid orders" value={totalOrders.toLocaleString("en-IN")} />
        <Stat label="Revenue" value={<Money paise={totalRevenue} />} />
        <Stat label="Average order" value={<Money paise={avgOrder} />} />
        <Stat label="Schools" value={bySchool.length.toLocaleString("en-IN")} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ReportTable
          title="By school"
          description={
            noSchool > 0
              ? `Highest revenue first · ${noSchool.toLocaleString("en-IN")} orders have no school`
              : "Highest revenue first"
          }
        >
          {bySchool.length === 0 ? (
            <EmptyState icon={BarChart3} title="No paid orders in this range" />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>School</Th>
                  <Th right>Paid orders</Th>
                  <Th right>Revenue</Th>
                </tr>
              </thead>
              <tbody>
                {bySchool.map((r) => (
                  <Tr key={r.schoolId}>
                    <Td>
                      <Link href={`/admin/schools/${r.schoolId}`} className="hover:text-brand-700">
                        {r.schoolName}
                      </Link>
                    </Td>
                    <Td right muted>{Number(r.orderCount).toLocaleString("en-IN")}</Td>
                    <Td right><Money paise={Number(r.revenue)} className="font-semibold" /></Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          )}
        </ReportTable>

        <ReportTable title="By month" description="Newest first">
          {byMonth.length === 0 ? (
            <EmptyState icon={BarChart3} title="No paid orders in this range" />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Month</Th>
                  <Th right>Paid orders</Th>
                  <Th right>Revenue</Th>
                </tr>
              </thead>
              <tbody>
                {byMonth.map((r) => (
                  <Tr key={r.month}>
                    <Td className="whitespace-nowrap">{monthLabel(r.month)}</Td>
                    <Td right muted>{Number(r.orderCount).toLocaleString("en-IN")}</Td>
                    <Td right><Money paise={Number(r.revenue)} className="font-semibold" /></Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          )}
        </ReportTable>
      </div>
    </div>
  );
}

/** "2026-07" → "Jul 2026". */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}
