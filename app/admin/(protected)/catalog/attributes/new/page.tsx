import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { schools } from "@/db/schema";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewAttributeForm } from "@/components/admin/NewAttributeForm";

export const dynamic = "force-dynamic";

export default async function NewAttributePage() {
  const guard = await requireAnyPermission("catalog-attributes.write", "catalog.write");
  if (isResponse(guard)) redirect("/admin/catalog/attributes");

  const schoolRows = await db.select({ id: schools.id, name: schools.name }).from(schools).orderBy(schools.name);

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Products"
        breadcrumb={[{ label: "Attributes", href: "/admin/catalog/attributes" }, { label: "New attribute" }]}
        title="New attribute"
        description="Name the axis first. You add its values on the next screen."
      />
      <Card>
        <NewAttributeForm schools={schoolRows} />
      </Card>
    </div>
  );
}
