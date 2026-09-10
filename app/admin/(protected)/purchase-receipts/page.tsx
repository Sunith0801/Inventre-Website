import Link from "next/link";
import { db } from "@/db/client";
import {
  purchaseReceipts,
  purchaseOrders,
  suppliers,
  warehouses,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { PackageCheck, Plus } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  EmptyState,
  Button,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

export default async function PurchaseReceiptsPage() {
  const guard = await requireAnyPermission("purchase-orders.read", "purchase-orders.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select({
      receipt: purchaseReceipts,
      poNumber: purchaseOrders.poNumber,
      supplierName: suppliers.name,
      warehouseName: warehouses.name,
    })
    .from(purchaseReceipts)
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseReceipts.poId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseReceipts.warehouseId))
    .orderBy(desc(purchaseReceipts.receivedAt))
    .limit(200);

  return (
    <div>
      <PageHeader
        eyebrow="Buying"
        title="Purchase receipts"
        description={`${rows.length} receipts · stock postings happen at receive time`}
        actions={
          <Link href="/admin/purchase-orders">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              Receive against PO
            </Button>
          </Link>
        }
      />

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            title="No receipts yet"
            description="Open a purchase order and click Receive to record incoming stock."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Receipt #</Th>
                <Th>PO</Th>
                <Th>Supplier</Th>
                <Th>Warehouse</Th>
                <Th right>Received at</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.receipt.id}>
                  <Td>
                    <span className="font-mono text-[12px] font-semibold">
                      {r.receipt.receiptNumber}
                    </span>
                  </Td>
                  <Td muted>
                    {r.poNumber ? (
                      <Link
                        href={`/admin/purchase-orders/${r.receipt.poId}`}
                        className="font-mono text-[12px] hover:text-brand-700"
                      >
                        {r.poNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>{r.supplierName}</Td>
                  <Td muted>{r.warehouseName}</Td>
                  <Td right muted>
                    {new Date(r.receipt.receivedAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
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
