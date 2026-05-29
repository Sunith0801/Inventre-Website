import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { WebsiteCartCouponForm } from "@/components/admin/WebsiteCartCouponForm";

export default function NewDiscountPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Discounts", href: "/admin/discounts" },
          { label: "New coupon" },
        ]}
        title="New Website Cart Coupon"
        description="Saved locally and immediately usable at checkout. (Legacy ERPNext mirror retired — coupons no longer round-trip to erp.inventre.in.)"
      />
      <Card>
        <WebsiteCartCouponForm mode="new" />
      </Card>
    </div>
  );
}
