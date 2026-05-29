import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { warehouses } from "@/db/schema";
import { asc } from "drizzle-orm";
import { getPurchaseOrder } from "@/lib/repos/purchase-orders";
import {
  PageHeader,
  Card,
  CardHeader,
  Badge,
  Money,
  Th,
  Td,
  Tr,
  statusTone,
} from "@/components/admin/ui/primitives";
import { ReceivePoButton } from "@/components/admin/ReceivePoButton";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getPurchaseOrder(id);
  if (!data) notFound();
  const { po, supplier, items } = data;
  const whs = await db
    .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
    .from(warehouses)
    .orderBy(asc(warehouses.name));
  const canReceive =
    po.status !== "received" &&
    po.status !== "cancelled" &&
    items.some((it) => it.receivedQty < it.qty);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Purchase orders", href: "/admin/purchase-orders" },
          { label: po.poNumber },
        ]}
        title={po.poNumber}
        description={
          <span className="flex items-center gap-3 text-[13px]">
            <span className="text-ink-500">Order date {po.orderDate}</span>
            <Badge tone={statusTone(po.status)} dot size="sm">
              {po.status.replace(/_/g, " ")}
            </Badge>
          </span>
        }
        actions={
          canReceive ? (
            <ReceivePoButton
              poId={po.id}
              warehouses={whs}
              items={items.map((it) => ({
                poItemId: it.id,
                description: it.description,
                qty: it.qty,
                receivedQty: it.receivedQty,
              }))}
            />
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card padded={false}>
            <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
              <CardHeader title="Items" description={`${items.length} lines`} />
            </div>
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Description</Th>
                  <Th right>Qty</Th>
                  <Th right>Received</Th>
                  <Th right>Unit price</Th>
                  <Th right>Total</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <Tr key={it.id}>
                    <Td>{it.description}</Td>
                    <Td right>{it.qty}</Td>
                    <Td right muted>
                      {it.receivedQty}
                    </Td>
                    <Td right>
                      <Money paise={it.unitPrice} />
                    </Td>
                    <Td right>
                      <Money paise={it.total} className="font-semibold" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-200">
                  <td colSpan={4} className="py-3 px-4 text-right text-[13px] font-semibold text-ink-700">
                    Grand total
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Money
                      paise={po.grandTotal}
                      className="font-display text-[16px] font-extrabold text-ink-900"
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>

          {po.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <p className="text-[13px] text-ink-700 whitespace-pre-wrap">{po.notes}</p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Supplier" />
            <p className="font-semibold text-ink-900">{supplier?.name ?? "—"}</p>
            <p className="text-[13px] text-ink-500 font-mono">
              {supplier?.supplierCode}
            </p>
            {supplier?.contactName ? (
              <p className="mt-2 text-[13px] text-ink-700">{supplier.contactName}</p>
            ) : null}
            {supplier?.phone ? (
              <p className="text-[13px] text-ink-700 font-mono">{supplier.phone}</p>
            ) : null}
          </Card>
          <Card>
            <CardHeader title="Schedule" />
            <div className="space-y-1.5 text-[13px]">
              <div>
                <span className="text-ink-500">Order date: </span>
                <span className="font-medium">{po.orderDate}</span>
              </div>
              <div>
                <span className="text-ink-500">Expected: </span>
                <span className="font-medium">{po.expectedDate ?? "—"}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
