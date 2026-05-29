import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { BulkImport } from "@/components/admin/BulkImportStudents";

export const dynamic = "force-dynamic";

export default function BulkImportStudentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People"
        title="Bulk import students"
        description="Upload a CSV (or Excel) sheet to add many students at once. Each parent can sign in straight after the import — OTP + set-password runs on first login."
      />
      <Card>
        <BulkImport />
      </Card>
    </div>
  );
}
