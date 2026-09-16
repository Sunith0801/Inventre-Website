import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { BulkImport } from "@/components/admin/BulkImportStudents";

export const dynamic = "force-dynamic";

export default function BulkImportStudentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer Relationship (CRM)"
        title="Bulk import students"
      />
      <Card>
        <BulkImport />
      </Card>
    </div>
  );
}
