import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { CreditCard, Plus } from "lucide-react";
import { db } from "@/db/client";
import { paymentEntries, parents, suppliers, invoices } from "@/db/schema";
import {
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
  PageHeader,
  Card,
  Button,
  Th,
  Td,
  Tr,
  Money,
  Badge,
  EmptyState,
  Stat,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const guard = await requireAnyPermission("payments.read", "payments.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select({
      p: paymentEntries,
      parentName: parents.name,
      parentPhone: parents.phone,
      supplierName: suppliers.name,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(paymentEntries)
    .leftJoin(parents, eq(parents.id, paymentEntries.parentId))
    .leftJoin(suppliers, eq(suppliers.id, paymentEntries.supplierId))
    .leftJoin(invoices, eq(invoices.id, paymentEntries.invoiceId))
    .orderBy(desc(paymentEntries.createdAt))
    .limit(200);

  const received = rows
    .filter((r) => r.p.direction === "received")
    .reduce((s, r) => s + r.p.amount, 0);
  const paid = rows
    .filter((r) => r.p.direction === "paid")
    .reduce((s, r) => s + r.p.amount, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Accounting"
        title="Payments"
        description={`${rows.length} payment entries · receipts in, refunds & supplier payouts out`}
        actions={
          <Link href="/admin/payments/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              Record payment
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <Stat label="Received" value={<Money paise={received} />} iconTone="success" />
        <Stat label="Paid out" value={<Money paise={paid} />} iconTone="warning" />
        <Stat label="Net" value={<Money paise={received - paid} />} iconTone="info" />
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No payment entries yet"
            description="Record customer receipts and supplier payouts to track ledger movements."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Payment #</Th>
                <Th>Type</Th>
                <Th>Method</Th>
                <Th>Counterparty</Th>
                <Th>Reference</Th>
                <Th right>Amount</Th>
                <Th right>Date</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.p.id}>
                  <Td>
                    <span className="font-mono text-[12px] font-semibold">
                      {r.p.paymentNumber}
                    </span>
                  </Td>
                  <Td>
                    <Badge
                      tone={r.p.direction === "received" ? "success" : "warning"}
                      size="sm"
                      dot
                    >
                      {r.p.direction}
                    </Badge>
                  </Td>
                  <Td muted>
                    <span className="text-[12px] capitalize">{r.p.method}</span>
                  </Td>
                  <Td>
                    <div className="font-medium">
                      {r.parentName ?? r.supplierName ?? "—"}
                    </div>
                    {r.parentPhone ? (
                      <div className="text-[11px] font-mono text-ink-500">
                        {r.parentPhone}
                      </div>
                    ) : null}
                  </Td>
                  <Td muted>
                    <span className="font-mono text-[11px]">
                      {r.invoiceNumber ?? r.p.referenceNumber ?? "—"}
                    </span>
                  </Td>
                  <Td right>
                    <Money paise={r.p.amount} className="font-semibold" />
                  </Td>
                  <Td right muted>
                    {r.p.paymentDate}
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
