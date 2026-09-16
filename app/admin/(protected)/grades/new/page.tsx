import { PageHeader, Card, CardHeader } from "@/components/admin/ui/primitives";
import { GradeEditor } from "@/components/admin/GradeEditor";

export default function NewGradePage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Catalog"
        breadcrumb={[{ label: "Grades", href: "/admin/grades" }, { label: "New grade" }]}
        title="New grade"
        description="Adds a grade to the master list used by schools and the catalog."
      />
      <Card>
        <CardHeader title="Grade details" />
        <GradeEditor mode="create" />
      </Card>
    </div>
  );
}
