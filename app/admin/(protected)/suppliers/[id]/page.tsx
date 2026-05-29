import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { suppliers, purchaseOrders, paymentEntries } from "@/db/schema";
import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
  Stat,
  Money,
  Th,
  Td,
  Tr,
  EmptyState,
  statusTone,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!s) notFound();

  const [pos, payments] = await Promise.all([
    db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.supplierId, id))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(20),
    db
      .select()
      .from(paymentEntries)
      .where(eq(paymentEntries.supplierId, id))
      .orderBy(desc(paymentEntries.createdAt))
      .limit(20),
  ]);

  const totalSpend = pos.reduce((sum, p) => sum + (p.grandTotal ?? 0), 0);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Suppliers", href: "/admin/suppliers" },
          { label: s.name },
        ]}
        title={s.name}
        description={
          <span className="flex items-center gap-3 text-[13px]">
            <span className="font-mono text-ink-500">{s.supplierCode}</span>
            <Badge tone={statusTone(s.status)} dot size="sm">
              {s.status}
            </Badge>
          </span>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Open POs" value={pos.filter((p) => p.status !== "received" && p.status !== "cancelled").length} />
        <Stat label="Lifetime spend" value={<Money paise={totalSpend} />} iconTone="info" />
        <Stat label="Payments" value={payments.length} />
        <Stat label="Payment terms" value={<span className="text-[15px]">{s.paymentTerms ?? "—"}</span>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card padded={false}>
            <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
              <CardHeader title="Recent purchase orders" description={`${pos.length} POs`} />
            </div>
            {pos.length === 0 ? (
              <EmptyState
                title="No purchase orders yet"
                description="Create one to start tracking inbound stock from this supplier."
              />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>PO #</Th>
                    <Th>Status</Th>
                    <Th right>Total</Th>
                    <Th right>Order date</Th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map((p) => (
                    <Tr key={p.id}>
                      <Td>
                        <Link
                          href={`/admin/purchase-orders/${p.id}`}
                          className="font-mono text-[12px] font-semibold text-ink-900 hover:text-brand-700"
                        >
                          {p.poNumber}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(p.status)} dot size="sm">
                          {p.status}
                        </Badge>
                      </Td>
                      <Td right>
                        <Money paise={p.grandTotal} />
                      </Td>
                      <Td right muted>
                        {p.orderDate}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Contact" />
            <p className="font-semibold text-ink-900">{s.contactName ?? "—"}</p>
            {s.phone ? <p className="text-[13px] text-ink-700 font-mono">{s.phone}</p> : null}
            {s.email ? <p className="text-[13px] text-ink-700">{s.email}</p> : null}
          </Card>
          <Card>
            <CardHeader title="Tax" />
            <div className="space-y-1.5 text-[13px]">
              <div>
                <span className="text-ink-500">GSTIN: </span>
                <span className="font-mono text-ink-900">{s.gstin ?? "—"}</span>
              </div>
              <div>
                <span className="text-ink-500">PAN: </span>
                <span className="font-mono text-ink-900">{s.pan ?? "—"}</span>
              </div>
            </div>
          </Card>
          {s.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <p className="text-[13px] text-ink-700 whitespace-pre-wrap">{s.notes}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
