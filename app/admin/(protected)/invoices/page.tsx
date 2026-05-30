import { FileText, Printer } from "lucide-react";
import Link from "next/link";
import { listInvoices } from "@/lib/repos/invoices";
import { ExportButton } from "@/components/admin/ExportButton";
import {
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
  Stat,
  IconBtn,
  Toolbar,
  SearchInput,
  Button,
  statusTone,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; fy?: string; q?: string }>;
}) {
  const guard = await requireAnyPermission("invoices.read", "invoices.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const { status, fy, q } = await searchParams;
  const rows = await listInvoices({ status, fy, q });

  // Aggregate summary
  const totals = rows.reduce(
    (acc, r) => {
      if (r.invoice.status === "cancelled") return acc;
      acc.count++;
      acc.gross += r.invoice.grandTotal;
      if (r.invoice.status === "paid") acc.paid += r.invoice.grandTotal;
      acc.outstanding += r.invoice.outstandingAmount ?? 0;
      return acc;
    },
    { count: 0, gross: 0, paid: 0, outstanding: 0 }
  );

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Invoices"
        description={`${rows.length} invoices · GST-compliant tax invoice records`}
        actions={<ExportButton type="invoices" />}
      />

      <form method="GET">
        <Toolbar>
          <SearchInput
            defaultValue={q ?? ""}
            placeholder="Search invoice #, customer name or phone…"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </Toolbar>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Active invoices" value={totals.count} iconTone="default" />
        <Stat label="Gross billed" value={<Money paise={totals.gross} />} iconTone="info" />
        <Stat label="Paid" value={<Money paise={totals.paid} />} iconTone="success" />
        <Stat label="Outstanding" value={<Money paise={totals.outstanding} />} iconTone="warning" />
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            description="Generate one from a delivered order, or use the Import (CSV/XLSX) tool."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Invoice #</Th>
                <Th>Date</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th right>Net</Th>
                <Th right>Tax</Th>
                <Th right>Grand total</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.invoice.id}>
                  <Td>
                    <span className="font-mono text-[12px] font-semibold text-ink-900">
                      {r.invoice.invoiceNumber}
                    </span>
                    {r.invoice.isReturn ? (
                      <Badge tone="violet" size="sm" className="ml-2">
                        Credit Note
                      </Badge>
                    ) : null}
                  </Td>
                  <Td muted>{r.invoice.postingDate}</Td>
                  <Td>
                    <div className="font-medium leading-tight">{r.parentName ?? "—"}</div>
                    <div className="text-[11px] font-mono text-ink-500">{r.parentPhone}</div>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.invoice.status)} dot size="sm">
                      {r.invoice.status}
                    </Badge>
                  </Td>
                  <Td right>
                    <Money paise={r.invoice.netTotal} />
                  </Td>
                  <Td right muted>
                    <Money paise={r.invoice.taxTotal} />
                  </Td>
                  <Td right>
                    <Money paise={r.invoice.grandTotal} className="font-semibold" />
                  </Td>
                  <Td right>
                    <Link href={`/admin/invoices/${r.invoice.id}/print`} target="_blank">
                      <IconBtn icon={<Printer className="h-4 w-4" />} label="Print" />
                    </Link>
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
