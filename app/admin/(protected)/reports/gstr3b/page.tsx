import { buildGstr3b } from "@/server/gstr3b";
import { Download } from "lucide-react";
import { PageHeader, Stat, Money, Th, Td, Tr } from "@/components/admin/ui/primitives";
import { ReportToolbar, reportRange } from "@/components/admin/reports/ReportToolbar";
import { ReportTable, DownloadLink } from "@/components/admin/reports/ReportTable";

export const dynamic = "force-dynamic";

export default async function Gstr3bReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { from, to } = reportRange(sp);

  const doc = await buildGstr3b({ from, to });
  const s = doc.sup_details;
  const o = s.osup_det;
  const totalTax = o.iamt + o.camt + o.samt;

  // Rupee amounts from the builder; Money takes paise.
  const rs = (n: number) => <Money paise={Math.round(n * 100)} />;

  const outward = [
    { code: "3.1(a)", label: "Outward taxable supplies", txval: o.txval, iamt: o.iamt, camt: o.camt, samt: o.samt },
    { code: "3.1(b)", label: "Zero-rated supplies", txval: s.osup_zero.txval, iamt: s.osup_zero.iamt, camt: 0, samt: 0 },
    { code: "3.1(c)", label: "Nil-rated / exempt supplies", txval: s.osup_nil_exmp.txval, iamt: 0, camt: 0, samt: 0 },
    { code: "3.1(d)", label: "Inward supplies (reverse charge)", txval: s.isup_rev.txval, iamt: s.isup_rev.iamt, camt: s.isup_rev.camt, samt: s.isup_rev.samt },
    { code: "3.1(e)", label: "Non-GST outward supplies", txval: s.osup_nongst.txval, iamt: 0, camt: 0, samt: 0 },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Overview & Analytics"
        breadcrumb={[{ label: "Reports", href: "/admin/reports" }, { label: "GSTR-3B" }]}
        title="GSTR-3B summary"
        actions={
          <DownloadLink href={`/api/admin/reports/gstr3b?from=${from}&to=${to}&format=json-download`}>
            <Download className="h-3.5 w-3.5" /> GSTR-3B JSON
          </DownloadLink>
        }
      />

      <ReportToolbar action="/admin/reports/gstr3b" from={from} to={to} requested={sp} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Taxable value" value={rs(o.txval)} />
        <Stat label="IGST" value={rs(o.iamt)} />
        <Stat label="CGST" value={rs(o.camt)} />
        <Stat label="SGST" value={rs(o.samt)} />
        <Stat label="Total tax" value={rs(totalTax)} />
      </div>

      <div className="space-y-5">
        <ReportTable
          title="3.1 Outward and reverse-charge supplies"
          description="Computed from invoices posted in the range. Sections 4 (ITC) and 6 (tax payment) are left for the accountant."
        >
          <table className="w-full">
            <thead>
              <tr>
                <Th>Section</Th>
                <Th>Nature of supply</Th>
                <Th right>Taxable value</Th>
                <Th right>IGST</Th>
                <Th right>CGST</Th>
                <Th right>SGST</Th>
              </tr>
            </thead>
            <tbody>
              {outward.map((r) => (
                <Tr key={r.code}>
                  <Td className="whitespace-nowrap"><span className="font-mono text-[12px]">{r.code}</span></Td>
                  <Td>{r.label}</Td>
                  <Td right>{rs(r.txval)}</Td>
                  <Td right muted>{rs(r.iamt)}</Td>
                  <Td right muted>{rs(r.camt)}</Td>
                  <Td right muted>{rs(r.samt)}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </ReportTable>

        <ReportTable title="3.2 Inter-state supplies to unregistered persons" description="By place of supply">
          {doc.inter_sup.unreg_details.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-ink-500">No inter-state supplies to unregistered persons in this range.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Place of supply</Th>
                  <Th right>Taxable value</Th>
                  <Th right>IGST</Th>
                </tr>
              </thead>
              <tbody>
                {doc.inter_sup.unreg_details.map((r, i) => (
                  <Tr key={i}>
                    <Td><span className="font-mono text-[12px]">{r.pos}</span></Td>
                    <Td right>{rs(r.txval)}</Td>
                    <Td right>{rs(r.iamt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          )}
        </ReportTable>
      </div>
    </div>
  );
}
