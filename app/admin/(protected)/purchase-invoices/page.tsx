import Link from "next/link";
import { db } from "@/db/client";
import {
  purchaseInvoices,
  purchaseOrders,
  suppliers,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { Receipt, Plus } from "lucide-react";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  Button,
  Money,
  statusTone,
} from "@/components/admin/ui/primitives";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

export default async function PurchaseInvoicesPage() {
  const guard = await requireAnyPermission("purchase-orders.read", "purchase-orders.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select({
      invoice: purchaseInvoices,
      supplierName: suppliers.name,
      poNumber: purchaseOrders.poNumber,
    })
    .from(purchaseInvoices)
    .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.poId))
    .orderBy(desc(purchaseInvoices.postingDate))
    .limit(200);

  return (
    <div>
      <PageHeader
        eyebrow="Buying"
        title="Purchase invoices"
        description={`${rows.length} supplier bills · used to track payables`}
        actions={
          <Link href="/admin/purchase-invoices/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              New invoice
            </Button>
          </Link>
        }
      />

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No supplier bills yet"
            description="Record bills from suppliers here to track payables."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Invoice #</Th>
                <Th>Supplier bill #</Th>
                <Th>Supplier</Th>
                <Th>PO</Th>
                <Th>Posting</Th>
                <Th>Status</Th>
                <Th right>Outstanding</Th>
                <Th right>Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.invoice.id}>
                  <Td>
                    <span className="font-mono text-[12px] font-semibold">
                      {r.invoice.invoiceNumber}
                    </span>
                  </Td>
                  <Td muted>
                    <span className="font-mono text-[12px]">
                      {r.invoice.supplierInvoiceNumber ?? "—"}
                    </span>
                  </Td>
                  <Td>{r.supplierName}</Td>
                  <Td muted>
                    {r.poNumber ? (
                      <Link
                        href={`/admin/purchase-orders/${r.invoice.poId}`}
                        className="font-mono text-[12px] hover:text-brand-700"
                      >
                        {r.poNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td muted>{r.invoice.postingDate}</Td>
                  <Td>
                    <Badge tone={statusTone(r.invoice.status)} dot size="sm">
                      {r.invoice.status.replace("_", " ")}
                    </Badge>
                  </Td>
                  <Td right>
                    <Money paise={r.invoice.outstandingAmount} />
                  </Td>
                  <Td right>
                    <Money
                      paise={r.invoice.grandTotal}
                      className="font-semibold"
                    />
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
