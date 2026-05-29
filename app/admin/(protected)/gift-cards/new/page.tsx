import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewGiftCardForm } from "@/components/admin/NewGiftCardForm";

export default function NewGiftCardPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        breadcrumb={[
          { label: "Gift cards", href: "/admin/gift-cards" },
          { label: "Issue new" },
        ]}
        title="Issue gift card"
        description="A 16-character code + checksum is generated and shown ONCE on success. Save it; we don't display it again."
      />
      <Card>
        <NewGiftCardForm />
      </Card>
    </div>
  );
}
