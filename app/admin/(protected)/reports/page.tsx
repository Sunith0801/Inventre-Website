import {
  BarChart3,
  Users,
  Receipt,
  Truck,
  Package,
  Hash,
  Wallet,
  FileText,
} from "lucide-react";
import { PageHeader } from "@/components/admin/ui/primitives";
import { ModuleCards, type ModuleCard } from "@/components/admin/ModuleCards";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

const reports: ModuleCard[] = [
  { href: "/admin/reports/sales", label: "Sales", icon: BarChart3, description: "Revenue by school and by month" },
  { href: "/admin/reports/items", label: "Item-wise sales", icon: Package, description: "Top-selling SKUs by revenue and quantity" },
  { href: "/admin/reports/customers", label: "Customers", icon: Users, description: "Top customers by lifetime value" },
  { href: "/admin/reports/fulfillment", label: "Fulfillment", icon: Truck, description: "Order status mix and cycle times" },
  { href: "/admin/reports/receivables", label: "Receivables aging", icon: Wallet, description: "Unpaid invoices by days past due" },
  { href: "/admin/reports/gst", label: "GST summary", icon: Receipt, description: "GSTR-1 outward supply by treatment" },
  { href: "/admin/reports/hsn", label: "HSN-wise summary", icon: Hash, description: "Per-HSN quantity, taxable value and tax" },
  { href: "/admin/reports/gstr3b", label: "GSTR-3B summary", icon: FileText, description: "Monthly self-declaration, outward sections" },
];

export default async function ReportsPage() {
  const guard = await requireAnyPermission("reports.read", "reports.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  return (
    <div>
      <PageHeader eyebrow="Overview & Analytics" title="Reports" />
      <ModuleCards items={reports} />
    </div>
  );
}
