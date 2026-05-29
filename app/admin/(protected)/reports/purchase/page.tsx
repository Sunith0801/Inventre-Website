import Link from "next/link";
import { db } from "@/db/client";
import { purchaseOrders, suppliers } from "@/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { ClipboardList } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  Stat,
  Money,
  statusTone,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function PurchaseRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string }>;
}) {
  const { from, to, status } = await searchParams;
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 2, 1)
    .toISOString()
    .slice(0, 10);
  const defaultTo = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  const fromDate = from || defaultFrom;
  const toDate = to || defaultTo;

  const conds = [
    gte(purchaseOrders.orderDate, fromDate),
    lte(purchaseOrders.orderDate, toDate),
  ];
  if (status) conds.push(eq(purchaseOrders.status, status as never));

  const rows = await db
    .select({
      po: purchaseOrders,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(...conds))
    .orderBy(desc(purchaseOrders.orderDate))
    .limit(500);

  const totals = rows.reduce(
    (a, r) => ({
      count: a.count + 1,
      subtotal: a.subtotal + (r.po.subtotal ?? 0),
      tax: a.tax + (r.po.taxTotal ?? 0),
      grand: a.grand + (r.po.grandTotal ?? 0),
    }),
    { count: 0, subtotal: 0, tax: 0, grand: 0 }
  );

  const supplierTotals = await db
    .select({
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      total: sql<number>`COALESCE(SUM(${purchaseOrders.grandTotal}), 0)::bigint`,
      count: sql<number>`COUNT(${purchaseOrders.id})::int`,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(...conds))
    .groupBy(suppliers.id, suppliers.name)
    .orderBy(desc(sql`SUM(${purchaseOrders.grandTotal})`))
    .limit(10);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "Purchase register" },
        ]}
        eyebrow="Reports"
        title="Purchase register"
        description="Purchase orders by supplier and date. Filter by status to see only open / received POs."
      />

      <form
        method="GET"
        className="mb-5 flex flex-wrap gap-2 items-end p-3 bg-white border border-ink-100/70 rounded-xl"
      >
        <DateField label="From" name="from" defaultValue={fromDate} />
        <DateField label="To" name="to" defaultValue={toDate} />
        <div>
          <label className="text-[11px] font-semibold text-ink-700 uppercase tracking-wider">
            Status
          </label>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="block mt-1 h-9 px-3 text-[13px] rounded-lg bg-cream-50 border border-ink-100"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="partially_received">Partially received</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
        >
          Apply
        </button>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="POs" value={totals.count} iconTone="default" />
        <Stat
          label="Subtotal"
          value={<Money paise={totals.subtotal} />}
          iconTone="info"
        />
        <Stat
          label="Tax"
          value={<Money paise={totals.tax} />}
          iconTone="warning"
        />
        <Stat
          label="Grand total"
          value={<Money paise={totals.grand} />}
          iconTone="brand"
        />
      </div>

      {supplierTotals.length > 0 ? (
        <Card className="mb-5">
          <h3 className="text-[14px] font-semibold text-ink-900 mb-3">
            Top suppliers
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {supplierTotals.map((s) => (
              <div
                key={s.supplierId}
                className="flex items-center justify-between p-2 rounded-lg bg-cream-50/40"
              >
                <span className="text-[13px] font-medium">{s.supplierName}</span>
                <div className="text-right">
                  <Money paise={Number(s.total)} className="font-semibold" />
                  <span className="text-[11px] text-ink-500 ml-2">
                    {s.count} PO{Number(s.count) === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No POs in this range"
            description="Adjust filters above."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>PO #</Th>
                <Th>Supplier</Th>
                <Th>Order date</Th>
                <Th>Status</Th>
                <Th right>Subtotal</Th>
                <Th right>Tax</Th>
                <Th right>Grand</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.po.id}>
                  <Td>
                    <Link
                      href={`/admin/purchase-orders/${r.po.id}`}
                      className="font-mono text-[12px] font-semibold hover:text-brand-700"
                    >
                      {r.po.poNumber}
                    </Link>
                  </Td>
                  <Td>{r.supplierName}</Td>
                  <Td muted>{r.po.orderDate}</Td>
                  <Td>
                    <Badge tone={statusTone(r.po.status)} dot size="sm">
                      {r.po.status.replace("_", " ")}
                    </Badge>
                  </Td>
                  <Td right>
                    <Money paise={r.po.subtotal} />
                  </Td>
                  <Td right muted>
                    <Money paise={r.po.taxTotal} fallback="—" />
                  </Td>
                  <Td right>
                    <Money paise={r.po.grandTotal} className="font-semibold" />
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
