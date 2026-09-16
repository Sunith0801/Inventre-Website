import { FileText, Printer } from "lucide-react";
import Link from "next/link";
import { listInvoices } from "@/server/repos/invoices";
import { ExportButton } from "@/components/admin/ExportButton";
import {
  PageHeader,
  Card,
  Th,
  Td,
  Tr,
  Badge,
  Money,
  EmptyState,
  Stat,
  Toolbar,
  SearchInput,
  FilterSelect,
  statusTone,
} from "@/components/admin/ui/primitives";
import { AutoSubmitForm } from "@/components/admin/AutoSubmitForm";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

const INVOICE_STATUSES = ["draft", "submitted", "paid", "partially_paid", "overdue", "cancelled"];
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  paid: "Paid",
  partially_paid: "Partly paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};
const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const fmtDay = (d: string | Date | null) => {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? String(d) : IST.format(t);
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; fy?: string; q?: string }>;
}) {
  const guard = await requireAnyPermission("invoices.read", "invoices.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = INVOICE_STATUSES.includes(sp.status ?? "") ? sp.status : "";
  const { fy } = sp;
  const rows = await listInvoices({ status: status || undefined, fy, q: q || undefined, limit: 200 });
  const hasFilter = !!(q || status || fy);

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
        eyebrow="Sales & Distribution"
        title="Invoices"
        description={`${rows.length >= 200 ? "Latest 200" : rows.length} invoice${rows.length === 1 ? "" : "s"}${hasFilter ? " in this filter" : ""} — totals below are for what is listed.`}
        actions={<ExportButton type="invoices" />}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat label="Invoices" value={totals.count} hint="Excluding cancelled" />
        <Stat label="Billed" value={<Money paise={totals.gross} />} />
        <Stat label="Paid" value={<Money paise={totals.paid} />} />
        <Stat label="Outstanding" value={<Money paise={totals.outstanding} />} />
      </div>

      <AutoSubmitForm action="/admin/invoices">
        <Toolbar>
          <SearchInput defaultValue={q} placeholder="Search invoice #, customer name or phone…" />
          <FilterSelect label="Status" name="status" defaultValue={status}>
            {INVOICE_STATUSES.map((st) => (
              <option key={st} value={st}>{STATUS_LABEL[st]}</option>
            ))}
          </FilterSelect>
          {fy ? <input type="hidden" name="fy" value={fy} /> : null}
          {hasFilter ? <Link href="/admin/invoices" className="text-[12.5px] text-ink-500 hover:text-ink-900">Clear</Link> : null}
        </Toolbar>
      </AutoSubmitForm>

      <Card padded={false} className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={hasFilter ? "No invoices match" : "No invoices yet"}
            description={hasFilter ? "Try a different search or clear the filters." : "Invoices are generated from delivered orders."}
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th right>Net</Th>
                <Th right>Tax</Th>
                <Th right>Total</Th>
                <Th right><span className="sr-only">Print</span></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.invoice.id}>
                  <Td>
                    <span className="block font-mono font-semibold text-ink-900">
                      {r.invoice.invoiceNumber}
                      {r.invoice.isReturn ? <Badge tone="violet" size="sm" className="ml-2">Credit note</Badge> : null}
                    </span>
                    <span className="block text-[12px] font-normal text-ink-500">{fmtDay(r.invoice.postingDate)}</span>
                  </Td>
                  <Td>
                    <span className="block font-medium text-ink-900">{r.parentName ?? <span className="text-ink-300">—</span>}</span>
                    <span className="block font-mono text-[12px] font-normal text-ink-500">{r.parentPhone}</span>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.invoice.status)} dot size="sm">{STATUS_LABEL[r.invoice.status] ?? r.invoice.status}</Badge>
                  </Td>
                  <Td right><Money paise={r.invoice.netTotal} /></Td>
                  <Td right muted>{r.invoice.taxTotal ? <Money paise={r.invoice.taxTotal} /> : <span className="text-ink-300">—</span>}</Td>
                  <Td right><Money paise={r.invoice.grandTotal} className="font-semibold" /></Td>
                  <Td right>
                    {/* One styled link. The old icon button wrapped in a link
                        nested a <button> inside an <a> (invalid HTML) and cost
                        one client component per row. */}
                    <Link
                      href={`/admin/invoices/${r.invoice.id}/print`}
                      target="_blank"
                      aria-label={`Print ${r.invoice.invoiceNumber}`}
                      title="Print"
                      className="inline-grid h-8 w-8 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100/70 hover:text-ink-900"
                    >
                      <Printer className="h-4 w-4" />
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  );
}
