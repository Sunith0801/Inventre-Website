import { PageHeader, Card, CardHeader } from "@/components/admin/ui/primitives";
import { GuardianEditor } from "@/components/admin/GuardianEditor";

export default function NewGuardianPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Customer Relationship (CRM)"
        breadcrumb={[{ label: "Guardians", href: "/admin/guardians" }, { label: "New guardian" }]}
        title="New guardian"
        description="Creates the guardian in ERPNext as well. Link students from the student record afterwards."
      />
      <Card>
        <CardHeader title="Contact details" />
        <GuardianEditor mode="create" />
      </Card>
    </div>
  );
}
