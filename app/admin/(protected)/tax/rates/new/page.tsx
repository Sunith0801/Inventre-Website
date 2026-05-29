import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewTaxRateForm } from "@/components/admin/NewTaxRateForm";

export default function NewTaxRatePage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        breadcrumb={[
          { label: "Pricing & Tax", href: "/admin/tax/rates" },
          { label: "Tax & GST", href: "/admin/tax/rates" },
          { label: "New rate" },
        ]}
        title="New tax rate"
        description="Define a GST slab — CGST + SGST for in-state, IGST for out-of-state. The default slab is used when no HSN-specific rule matches."
      />
      <Card>
        <NewTaxRateForm />
      </Card>
    </div>
  );
}
