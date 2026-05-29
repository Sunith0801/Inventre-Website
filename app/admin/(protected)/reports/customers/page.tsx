import Link from "next/link";
import { sql, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import {
  PageHeader,
  Card,
  CardHeader,
  Stat,
  Th,
  Td,
  Tr,
  Money,
  EmptyState,
} from "@/components/admin/ui/primitives";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CustomersReport() {
  const [summary] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      active: sql<number>`COUNT(*) FILTER (WHERE ${parents.totalOrderCount} > 0)::int`,
      avgLTV: sql<number>`COALESCE(AVG(${parents.totalLifetimeValue}), 0)::bigint`,
    })
    .from(parents);

  const top = await db
    .select()
    .from(parents)
    .orderBy(desc(parents.totalLifetimeValue))
    .limit(50);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "Customers" },
        ]}
        title="Customer report"
        description="Top customers by lifetime value, plus signup trends."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
        <Stat label="Total customers" value={Number(summary?.total ?? 0).toLocaleString("en-IN")} iconTone="default" />
        <Stat label="Active (≥1 order)" value={Number(summary?.active ?? 0).toLocaleString("en-IN")} iconTone="success" />
        <Stat label="Average LTV" value={<Money paise={Number(summary?.avgLTV ?? 0)} />} iconTone="brand" />
      </div>

      <Card padded={false}>
        <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
          <CardHeader title="Top 50 by lifetime value" description="Highest-spending customers" />
        </div>
        {top.length === 0 ? (
          <EmptyState icon={Users} title="No customers yet" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Customer</Th>
                <Th>Phone</Th>
                <Th right>Orders</Th>
                <Th right>Lifetime value</Th>
                <Th right>Last order</Th>
              </tr>
            </thead>
            <tbody>
              {top.map((p, i) => (
                <Tr key={p.id}>
                  <Td muted>{i + 1}</Td>
                  <Td>
                    <Link
                      href={`/admin/customers/${p.id}`}
                      className="font-medium hover:text-brand-700 transition-colors"
                    >
                      {p.name ?? <span className="text-ink-400">— no name —</span>}
                    </Link>
                  </Td>
                  <Td>
                    <span className="font-mono text-[12px] text-ink-700">{p.phone}</span>
                  </Td>
                  <Td right>{p.totalOrderCount}</Td>
                  <Td right>
                    <Money paise={p.totalLifetimeValue} className="font-semibold" />
                  </Td>
                  <Td right muted>
                    {p.lastOrderAt
                      ? new Date(p.lastOrderAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })
                      : "—"}
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
