import { PageHeader } from "@/components/admin/ui/primitives";
import { getPaymentCharges } from "@/server/payment-charges";
import { PaymentChargesForm } from "./form";

export const dynamic = "force-dynamic";

export default async function PaymentChargesPage() {
  const config = await getPaymentCharges();
  return (
    <div>
      <PageHeader
        eyebrow="Pricing & Tax"
        title="Payment Surcharges"
        description="The gateway-fee notice shown at checkout. Changes apply immediately."
      />
      <PaymentChargesForm initial={config} />
    </div>
  );
}
