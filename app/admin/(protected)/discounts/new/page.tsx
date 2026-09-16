import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { WebsiteCartCouponForm } from "@/components/admin/WebsiteCartCouponForm";

export default function NewDiscountPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[{ label: "Discounts & Promotions", href: "/admin/discounts" }, { label: "New coupon" }]}
        eyebrow="Pricing & Tax"
        title="New coupon"
      />
      <Card>
        <WebsiteCartCouponForm mode="new" />
      </Card>
    </div>
  );
}
