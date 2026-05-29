import { db } from "@/db/client";
import { schools } from "@/db/schema";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewAttributeForm } from "@/components/admin/NewAttributeForm";

export const dynamic = "force-dynamic";

export default async function NewAttributePage() {
  const schoolRows = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .orderBy(schools.name);

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Catalog", href: "/admin/catalog/attributes" },
          { label: "Attributes", href: "/admin/catalog/attributes" },
          { label: "New attribute" },
        ]}
        title="New attribute"
        description="Define a variant dimension (Size, Colour, Design, …). Optionally scope to a single school."
      />
      <Card>
        <NewAttributeForm schools={schoolRows} />
      </Card>
    </div>
  );
}
