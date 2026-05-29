import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { SchoolEditor } from "@/components/admin/SchoolEditor";

export default function NewSchoolPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        breadcrumb={[{ label: "Schools", href: "/admin/schools" }, { label: "New school" }]}
        eyebrow="School"
        title="Create a new school"
        description="Enter the school details. You can add coordinators and SKU mappings after the school is created."
      />
      <Card>
        <SchoolEditor mode="create" />
      </Card>
    </div>
  );
}
