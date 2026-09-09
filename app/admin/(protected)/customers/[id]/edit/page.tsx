import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { EditCustomerForm } from "@/components/admin/EditCustomerForm";
import { RecordHistory } from "@/components/admin/RecordHistory";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [c] = await db.select().from(parents).where(eq(parents.id, id)).limit(1);
  if (!c) notFound();

  return (
    <div className="max-w-2xl">
      <PageHeader
        breadcrumb={[
          { label: "Customers", href: "/admin/customers" },
          { label: c.name ?? c.phone, href: `/admin/customers/${id}` },
          { label: "Edit" },
        ]}
        title={`Edit ${c.name ?? c.phone}`}
        description="Phone number is the unique key — change carefully."
      />
      <Card>
        <EditCustomerForm
          customer={{
            id: c.id,
            name: c.name,
            email: c.email,
            status: c.status,
            customerGroup: c.customerGroup,
            notes: c.notes,
          }}
        />
      </Card>

      <div className="mt-5">
        <RecordHistory entityType="customer" entityId={id} title="Customer history" />
      </div>
    </div>
  );
}
