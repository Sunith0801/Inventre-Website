import { sql, gte, and } from "drizzle-orm";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { PageHeader, Stat, Th, Td, Tr, Badge, Toolbar, FilterSelect, statusTone } from "@/components/admin/ui/primitives";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { ReportTable } from "@/components/admin/reports/ReportTable";

export const dynamic = "force-dynamic";

const WINDOWS = [7, 30, 90] as const;
type Window = (typeof WINDOWS)[number];

// Every value of the `order_status` enum, in lifecycle order. "Returned" was
// missing, so its orders counted in the total but in no row and the shares
// did not add up to 100%.
const STATUSES = [
  ["placed", "Placed"],
  ["confirmed", "Confirmed"],
  ["packed", "Packed"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
  ["returned", "Returned"],
  ["cancelled", "Cancelled"],
] as const;
type StatusKey = (typeof STATUSES)[number][0];

export default async function FulfillmentReport({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days: Window = WINDOWS.includes(Number(sp.days) as Window) ? (Number(sp.days) as Window) : 30;
  const since = new Date(Date.now() - days * 86400_000);

  const [[dist], [cycle]] = await Promise.all([
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        placed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'placed')::int`,
        confirmed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'confirmed')::int`,
        packed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'packed')::int`,
        shipped: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'shipped')::int`,
        delivered: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'delivered')::int`,
        returned: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'returned')::int`,
        cancelled: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'cancelled')::int`,
      })
      .from(orders)
      .where(gte(orders.createdAt, since)),
    db
      .select({
        delivered: sql<number>`COUNT(*)::int`,
        placedToConfirmed: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.confirmedAt} - ${orders.placedAt})) / 3600)`,
        confirmedToShipped: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.shippedAt} - ${orders.confirmedAt})) / 3600)`,
        shippedToDelivered: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.deliveredAt} - ${orders.shippedAt})) / 3600)`,
        placedToDelivered: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.deliveredAt} - ${orders.placedAt})) / 3600)`,
      })
      .from(orders)
      .where(and(gte(orders.createdAt, since), sql`${orders.deliveredAt} IS NOT NULL`)),
  ]);

  const total = Number(dist?.total ?? 0);
  const count = (k: StatusKey) => Number(dist?.[k] ?? 0);
  const share = (n: number) => (total ? `${Math.round((n / total) * 100)}% of orders` : undefined);
  const hours = (h: number | null | undefined) => (h == null ? "—" : `${Number(h).toFixed(1)} h`);
  const windowLabel = `last ${days} days`;

  return (
    <div>
      <PageHeader
        eyebrow="Overview & Analytics"
        breadcrumb={[{ label: "Reports", href: "/admin/reports" }, { label: "Fulfillment" }]}
        title="Fulfillment report"
      />

      <AutoSubmitForm action="/admin/reports/fulfillment">
        <Toolbar>
          <FilterSelect label="Orders placed in" noAll name="days" defaultValue={String(days)}>
            {WINDOWS.map((d) => (
              <option key={d} value={d}>Last {d} days</option>
            ))}
          </FilterSelect>
        </Toolbar>
      </AutoSubmitForm>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Orders · ${windowLabel}`} value={total.toLocaleString("en-IN")} />
        <Stat label="Delivered" value={count("delivered").toLocaleString("en-IN")} hint={share(count("delivered"))} />
        <Stat label="Cancelled or returned" value={(count("cancelled") + count("returned")).toLocaleString("en-IN")} hint={share(count("cancelled") + count("returned"))} />
        <Stat label="Placed to delivered" value={hours(cycle?.placedToDelivered)} hint="Average, delivered orders" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ReportTable title="Order status" description={`Orders placed in the ${windowLabel}, by current status`}>
          <table className="w-full">
            <thead>
              <tr>
                <Th>Status</Th>
                <Th right>Orders</Th>
                <Th right>Share</Th>
              </tr>
            </thead>
            <tbody>
              {STATUSES.map(([key, label]) => {
                const n = count(key);
                const pct = total ? (n / total) * 100 : 0;
                return (
                  <Tr key={key}>
                    <Td><Badge tone={statusTone(key)} dot>{label}</Badge></Td>
                    <Td right>{n.toLocaleString("en-IN")}</Td>
                    <Td right muted>
                      <span className="inline-flex items-center justify-end gap-2">
                        <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-cream-200 sm:block">
                          <span className="block h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-10 text-right tabular-nums">{pct.toFixed(0)}%</span>
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        </ReportTable>

        <ReportTable
          title="Cycle time"
          description={`Average hours per stage over ${Number(cycle?.delivered ?? 0).toLocaleString("en-IN")} delivered orders`}
        >
          <table className="w-full">
            <thead>
              <tr>
                <Th>Stage</Th>
                <Th right>Average</Th>
              </tr>
            </thead>
            <tbody>
              <Tr><Td>Placed → Confirmed</Td><Td right>{hours(cycle?.placedToConfirmed)}</Td></Tr>
              <Tr><Td>Confirmed → Shipped</Td><Td right>{hours(cycle?.confirmedToShipped)}</Td></Tr>
              <Tr><Td>Shipped → Delivered</Td><Td right>{hours(cycle?.shippedToDelivered)}</Td></Tr>
              <Tr><Td>Placed → Delivered</Td><Td right><span className="font-semibold">{hours(cycle?.placedToDelivered)}</span></Td></Tr>
            </tbody>
          </table>
        </ReportTable>
      </div>
    </div>
  );
}
