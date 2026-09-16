import { db } from "@/db/client";
import { schools } from "@/db/schema";
import { asc } from "drizzle-orm";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { AdminOrderBuilder } from "@/components/admin/AdminOrderBuilder";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const schoolRows = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .orderBy(asc(schools.name));

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Sales & Distribution"
        breadcrumb={[{ label: "Sales Orders", href: "/admin/orders" }, { label: "New order" }]}
        title="Create order"
        description="Place an order on a parent's behalf — for example over the phone."
      />
      <Card>
        <AdminOrderBuilder schools={schoolRows} />
      </Card>
    </div>
  );
}
