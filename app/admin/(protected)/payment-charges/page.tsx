import { PageHeader, Card, CardHeader } from "@/components/admin/ui/primitives";
import { getPaymentCharges } from "@/server/payment-charges";
import { PaymentChargesForm } from "./form";

export const dynamic = "force-dynamic";

export default async function PaymentChargesPage() {
  const config = await getPaymentCharges();
  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Payment Charges" },
          { label: "Payment charges" },
        ]}
        title="Payment charges"
        eyebrow="Payment Charges"
        description="Edit the payment-gateway fee schedule shown on the checkout page. Saved values appear immediately for shoppers — no redeploy needed."
      />

      <Card>
        <CardHeader
          title="Fee schedule"
          description="Heading text, intro line, the per-method rate table, and the footnote about GST + the 1% platform charge."
        />
        <PaymentChargesForm initial={config} />
      </Card>
    </div>
  );
}
