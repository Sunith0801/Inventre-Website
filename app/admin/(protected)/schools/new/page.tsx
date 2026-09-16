import { PageHeader, Card, CardHeader } from "@/components/admin/ui/primitives";
import { SchoolEditor } from "@/components/admin/SchoolEditor";

export default function NewSchoolPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Catalog"
        breadcrumb={[{ label: "Schools", href: "/admin/schools" }, { label: "New school" }]}
        title="New school"
        description="Creates the school record; grades, coordinators and uniform SKUs are added on the next screen."
      />
      <Card>
        <CardHeader title="School details" />
        <SchoolEditor mode="create" />
      </Card>
    </div>
  );
}
