import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { GuardianEditor } from "@/components/admin/GuardianEditor";

export default function NewGuardianPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader breadcrumb={[{ label: "Guardians", href: "/admin/guardians" }, { label: "New guardian" }]} eyebrow="Guardian" title="Create a new guardian" description="Guardians are people who can be linked to one or more students. They don't log in to the storefront — that's the parent account." />
      <Card><GuardianEditor mode="create" /></Card>
    </div>
  );
}
