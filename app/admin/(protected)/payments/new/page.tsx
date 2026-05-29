import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewPaymentForm } from "@/components/admin/NewPaymentForm";

export default function NewPaymentPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        breadcrumb={[
          { label: "Payments", href: "/admin/payments" },
          { label: "Record payment" },
        ]}
        title="Record payment"
        description="Capture a customer receipt or a supplier/refund payout."
      />
      <Card>
        <NewPaymentForm />
      </Card>
    </div>
  );
}
