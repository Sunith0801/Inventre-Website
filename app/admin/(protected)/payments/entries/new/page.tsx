import { PageHeader, Card, CardHeader } from "@/components/admin/ui/primitives";
import { NewPaymentForm } from "@/components/admin/NewPaymentForm";

export default function NewPaymentPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Finance"
        breadcrumb={[{ label: "Manual Entries", href: "/admin/payments/entries" }, { label: "Record payment" }]}
        title="Record payment"
        description="A cheque, bank transfer, cash receipt or refund handled outside the gateway."
      />
      <Card>
        <CardHeader title="Payment details" />
        <NewPaymentForm />
      </Card>
    </div>
  );
}
