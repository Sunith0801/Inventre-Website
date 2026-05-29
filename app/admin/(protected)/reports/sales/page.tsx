import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orders, schools } from "@/db/schema";
import {
  PageHeader,
  Card,
  CardHeader,
  Th,
  Td,
  Tr,
  Money,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SalesReport() {
  const bySchool = await db
    .select({
      schoolName: schools.name,
      orderCount: sql<number>`COUNT(${orders.id})::int`,
      revenue: sql<number>`COALESCE(SUM(${orders.total}), 0)::bigint`,
    })
    .from(orders)
    .innerJoin(schools, eq(schools.id, orders.schoolId))
    .where(sql`${orders.paymentStatus} = 'paid'`)
    .groupBy(schools.id, schools.name)
    .orderBy(sql`SUM(${orders.total}) DESC`);

  const byMonth = await db
    .select({
      month: sql<string>`TO_CHAR(${orders.createdAt}, 'YYYY-MM')`,
      orderCount: sql<number>`COUNT(${orders.id})::int`,
      revenue: sql<number>`COALESCE(SUM(${orders.total}), 0)::bigint`,
    })
    .from(orders)
    .where(sql`${orders.paymentStatus} = 'paid'`)
    .groupBy(sql`TO_CHAR(${orders.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${orders.createdAt}, 'YYYY-MM') DESC`);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "Sales" },
        ]}
        title="Sales report"
        description="Paid revenue grouped by school and month. Excludes cancelled orders."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card padded={false}>
          <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
            <CardHeader title="By school" description="Top schools by paid revenue" />
          </div>
          {bySchool.length === 0 ? (
            <EmptyState icon={BarChart3} title="No paid orders yet" />
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
                {bySchool.map((r, i) => (
                  <Tr key={i}>
                    <Td>{r.schoolName}</Td>
                    <Td right>{r.orderCount}</Td>
                    <Td right>
                      <Money paise={Number(r.revenue)} className="font-semibold" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card padded={false}>
          <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
            <CardHeader title="By month" description="Latest months first" />
          </div>
          {byMonth.length === 0 ? (
            <EmptyState icon={BarChart3} title="No paid orders yet" />
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
                {byMonth.map((r, i) => (
                  <Tr key={i}>
                    <Td>
                      <span className="font-mono text-[13px]">{r.month}</span>
                    </Td>
                    <Td right>{r.orderCount}</Td>
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
    </div>
  );
}
