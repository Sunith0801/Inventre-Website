import { buildGstr3b } from "@/server/gstr3b";
import { Receipt, Download } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  Stat,
  Money,
  Th,
  Td,
  Tr,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function Gstr3bReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const today = new Date();
  const from =
    sp.from ??
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to =
    sp.to ??
    new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  const doc = await buildGstr3b({ from, to });
  const o = doc.sup_details.osup_det;

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "GSTR-3B" },
        ]}
        eyebrow="Reports"
        title="GSTR-3B summary"
        description="Monthly self-declaration return. Outward sections compute from invoices automatically; ITC and tax-payment sections require accountant input."
        actions={
          <a
            href={`/api/admin/reports/gstr3b?from=${from}&to=${to}&format=json-download`}
            download
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
          >
            <Download className="h-3.5 w-3.5" />
            GSTR-3B JSON
          </a>
        }
      />

      <form
        method="GET"
        className="mb-5 flex flex-wrap gap-2 items-end p-3 bg-white border border-ink-100/70 rounded-xl"
      >
        <DateField label="From" name="from" defaultValue={from} />
        <DateField label="To" name="to" defaultValue={to} />
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800"
        >
          Apply
        </button>
      </form>

      <Card className="mb-5">
        <CardHeader
          title="3.1(a) Outward taxable supplies"
          description="Other than zero-rated, nil-rated, exempt"
        />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Taxable" value={<Money paise={o.txval * 100} />} iconTone="info" />
          <Stat label="IGST" value={<Money paise={o.iamt * 100} />} iconTone="default" />
          <Stat label="CGST" value={<Money paise={o.camt * 100} />} iconTone="default" />
          <Stat label="SGST" value={<Money paise={o.samt * 100} />} iconTone="default" />
          <Stat
            label="Total tax"
            value={<Money paise={(o.iamt + o.camt + o.samt) * 100} />}
            iconTone="brand"
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <Card>
          <CardHeader title="3.1(c) Nil / Exempt" />
          <Money
            paise={doc.sup_details.osup_nil_exmp.txval * 100}
            className="text-[20px] font-bold"
          />
        </Card>
        <Card>
          <CardHeader title="3.1(e) Non-GST" />
          <Money
            paise={doc.sup_details.osup_nongst.txval * 100}
            className="text-[20px] font-bold"
          />
        </Card>
        <Card>
          <CardHeader title="3.1(b) Zero-rated" />
          <Money
            paise={doc.sup_details.osup_zero.txval * 100}
            className="text-[20px] font-bold text-ink-400"
          />
        </Card>
      </div>

      <Card padded={false}>
        <div className="px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
          <CardHeader
            title="3.2 Inter-state to unregistered (by place of supply)"
            description="Subset of 3.1 broken down by destination state code"
          />
        </div>
        {doc.inter_sup.unreg_details.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-ink-500">
            No inter-state unregistered supplies.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <Th>Place of supply (state code)</Th>
                <Th right>Taxable value</Th>
                <Th right>IGST</Th>
              </tr>
            </thead>
            <tbody>
              {doc.inter_sup.unreg_details.map((r, i) => (
                <Tr key={i}>
                  <Td>
                    <span className="font-mono text-[12px]">{r.pos}</span>
                  </Td>
                  <Td right>
                    <Money paise={r.txval * 100} />
                  </Td>
                  <Td right>
                    <Money paise={r.iamt * 100} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="mt-5 text-[12px] text-ink-500">
        Section 4 (ITC) and Section 6 (Tax payment) values must be filled by your
        accountant before filing — they require purchase data + bank
        reconciliation outside this system.
      </p>
    </div>
  );
}

function DateField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-ink-700 uppercase tracking-wider">
        {label}
      </label>
      <input
        type="date"
        name={name}
        defaultValue={defaultValue}
        className="block mt-1 h-9 px-3 text-[13px] rounded-lg bg-cream-50 border border-ink-100"
      />
    </div>
  );
}
