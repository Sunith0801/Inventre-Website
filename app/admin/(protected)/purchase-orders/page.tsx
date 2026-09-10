import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { listPurchaseOrders } from "@/server/repos/purchase-orders";
import {
  PageHeader,
  Card,
  Toolbar,
  FilterChips,
  Button,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
  statusTone,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const guard = await requireAnyPermission("purchase-orders.read", "purchase-orders.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { status } = await searchParams;
  const rows = await listPurchaseOrders({ status });

  return (
    <div>
      <PageHeader
        eyebrow="Buying"
        title="Purchase orders"
        description={`${rows.length} POs · inbound orders to your suppliers`}
        actions={
          <Link href="/admin/purchase-orders/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              New PO
            </Button>
          </Link>
        }
      />

      <Toolbar>
        <FilterChips
          options={[
            { value: null, label: "All" },
            { value: "draft", label: "Draft" },
            { value: "submitted", label: "Submitted" },
            { value: "partially_received", label: "Partial" },
            { value: "received", label: "Received" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          value={status ?? null}
          baseHref="/admin/purchase-orders"
          paramName="status"
        />
      </Toolbar>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No purchase orders"
            description="Create one to start tracking inbound stock from suppliers."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>PO #</Th>
                <Th>Supplier</Th>
                <Th>Status</Th>
                <Th right>Total</Th>
                <Th right>Order date</Th>
                <Th right>Expected</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.po.id}>
                  <Td>
                    <Link
                      href={`/admin/purchase-orders/${r.po.id}`}
                      className="font-mono text-[12px] font-semibold text-ink-900 hover:text-brand-700 transition-colors"
                    >
                      {r.po.poNumber}
                    </Link>
                  </Td>
                  <Td>
                    <div className="font-medium leading-tight">{r.supplierName}</div>
                    <div className="text-[11px] font-mono text-ink-500">
                      {r.supplierCode}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.po.status)} dot size="sm">
                      {r.po.status.replace(/_/g, " ")}
                    </Badge>
                  </Td>
                  <Td right>
                    <Money paise={r.po.grandTotal} className="font-semibold" />
                  </Td>
                  <Td right muted>
                    {r.po.orderDate}
                  </Td>
                  <Td right muted>
                    {r.po.expectedDate ?? "—"}
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
