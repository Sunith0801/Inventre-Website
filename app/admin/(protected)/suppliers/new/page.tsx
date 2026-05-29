import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewSupplierForm } from "@/components/admin/NewSupplierForm";

export default function NewSupplierPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        breadcrumb={[
          { label: "Suppliers", href: "/admin/suppliers" },
          { label: "New supplier" },
        ]}
        title="New supplier"
        description="Vendors who fulfill purchase orders. The supplier code is auto-generated."
      />
      <Card>
        <NewSupplierForm />
      </Card>
    </div>
  );
}
