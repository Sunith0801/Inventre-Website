import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { GradeEditor } from "@/components/admin/GradeEditor";

export default function NewGradePage() {
  return (
    <div className="max-w-2xl">
      <PageHeader breadcrumb={[{ label: "Grades", href: "/admin/grades" }, { label: "New grade" }]} eyebrow="Grade" title="Create a new grade" />
      <Card><GradeEditor mode="create" /></Card>
    </div>
  );
}
