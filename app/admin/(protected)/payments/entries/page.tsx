import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { CreditCard, Plus } from "lucide-react";
import { db } from "@/db/client";
import { paymentEntries, parents, invoices } from "@/db/schema";
import {
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
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

const fmtDay = (d: string | Date | null) => {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export default async function PaymentEntriesPage() {
  const guard = await requireAnyPermission("payment-entries.read", "payment-entries.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select({
      p: paymentEntries,
      parentName: parents.name,
      parentPhone: parents.phone,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(paymentEntries)
    .leftJoin(parents, eq(parents.id, paymentEntries.parentId))
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
        eyebrow="Finance"
        title="Manual Entries"
        description={`${rows.length} entr${rows.length === 1 ? "y" : "ies"} recorded by hand — cheques, bank transfers, cash and refunds.`}
        actions={
          <Link href="/admin/payments/entries/new">
            <Button icon={<Plus className="h-3.5 w-3.5" />} variant="primary">
              Record payment
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <Stat label="Received" value={<Money paise={received} />} />
        <Stat label="Paid out" value={<Money paise={paid} />} hint="Refunds" />
        <Stat label="Net" value={<Money paise={received - paid} />} />
      </div>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No payment entries yet"
            description="Cheques, bank transfers, cash and refunds you record by hand appear here."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Payment</Th>
                <Th>Customer</Th>
                <Th>Type</Th>
                <Th>Method</Th>
                <Th>Reference</Th>
                <Th right>Amount</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.p.id}>
                  <Td><span className="font-mono font-semibold">{r.p.paymentNumber}</span></Td>
                  <Td>
                    <span className="block font-medium text-ink-900">{r.parentName ?? <span className="text-ink-300">—</span>}</span>
                    {r.parentPhone ? <span className="block font-mono text-[12px] font-normal text-ink-500">{r.parentPhone}</span> : null}
                  </Td>
                  <Td>
                    <Badge tone={r.p.direction === "received" ? "success" : "warning"} size="sm" dot>
                      {r.p.direction === "received" ? "Received" : "Paid out"}
                    </Badge>
                  </Td>
                  <Td muted className="capitalize">{r.p.method.replace(/_/g, " ")}</Td>
                  <Td muted><span className="font-mono">{r.invoiceNumber ?? r.p.referenceNumber ?? "—"}</span></Td>
                  <Td right><Money paise={r.p.amount} className="font-semibold" /></Td>
                  <Td muted className="whitespace-nowrap">{fmtDay(r.p.paymentDate)}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
