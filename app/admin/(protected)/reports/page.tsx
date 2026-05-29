import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Users,
  Receipt,
  Truck,
  Package,
  Hourglass,
  Hash,
  ClipboardList,
  Wallet,
  FileText,
} from "lucide-react";
import {
  PageHeader,
  Card,
} from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

const reports = [
  {
    href: "/admin/reports/sales",
    title: "Sales report",
    description: "Revenue by school × period × group. JSON API at /api/admin/reports/sales.",
    icon: BarChart3,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    href: "/admin/reports/stock",
    title: "Stock report",
    description: "Valuation, low-stock alerts, negative-stock items.",
    icon: Boxes,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    href: "/admin/reports/customers",
    title: "Customer report",
    description: "Top customers by lifetime value · signup trends · activity.",
    icon: Users,
    tone: "bg-violet-50 text-violet-700",
  },
  {
    href: "/admin/reports/gst",
    title: "GST summary",
    description: "GSTR-1-style outward supply: by treatment + place of supply.",
    icon: Receipt,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    href: "/admin/reports/fulfillment",
    title: "Fulfillment report",
    description: "Order status distribution, cycle times across the lifecycle.",
    icon: Truck,
    tone: "bg-brand-50 text-brand-700",
  },
  {
    href: "/admin/reports/items",
    title: "Item-wise sales",
    description: "Top-selling SKUs by revenue and quantity, with CSV export.",
    icon: Package,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    href: "/admin/reports/hsn",
    title: "HSN-wise summary",
    description: "GSTR-1 §12 shape: per-HSN qty, taxable value, and tax breakup.",
    icon: Hash,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    href: "/admin/reports/stock-ageing",
    title: "Stock ageing",
    description: "On-hand stock bucketed by days since last inbound. Spots slow movers.",
    icon: Hourglass,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    href: "/admin/reports/purchase",
    title: "Purchase register",
    description: "POs by supplier and date range, with top-supplier rollup.",
    icon: ClipboardList,
    tone: "bg-violet-50 text-violet-700",
  },
  {
    href: "/admin/reports/gstr3b",
    title: "GSTR-3B summary",
    description: "Monthly self-declaration. Outward sections auto-computed; ITC needs accountant.",
    icon: FileText,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    href: "/admin/reports/receivables",
    title: "Receivables aging",
    description: "Unpaid invoices bucketed by days past due.",
    icon: Wallet,
    tone: "bg-amber-50 text-amber-700",
  },
];

export default function ReportsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Tools"
        title="Reports"
        description="Operational + financial reports. Each card opens a focused view; the same data is available as JSON at the matching /api/admin/reports/* endpoint."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reports.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="group rounded-2xl border border-ink-100/70 bg-white p-5 shadow-[0_1px_2px_rgba(10,10,10,0.03)] hover:shadow-[0_4px_12px_rgba(10,10,10,0.05)] hover:-translate-y-0.5 transition-all duration-200"
          >
            <div className="flex items-start justify-between">
              <div className={`grid h-10 w-10 place-items-center rounded-xl ${r.tone}`}>
                <r.icon className="h-5 w-5" />
              </div>
              <ArrowRight className="h-4 w-4 text-ink-300 group-hover:text-ink-700 group-hover:translate-x-0.5 transition-[color,transform]" />
            </div>
            <h3 className="mt-4 text-[16px] font-semibold text-ink-900 leading-tight">
              {r.title}
            </h3>
            <p className="mt-1 text-[13px] text-ink-500 leading-relaxed">{r.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
