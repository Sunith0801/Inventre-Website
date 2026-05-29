import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewCustomerForm } from "@/components/admin/NewCustomerForm";

export default function NewCustomerPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        breadcrumb={[
          { label: "Customers", href: "/admin/customers" },
          { label: "New customer" },
        ]}
        title="New customer"
        description="Create a parent record manually. Customers normally self-register via OTP."
      />
      <Card>
        <NewCustomerForm />
      </Card>
    </div>
  );
}
