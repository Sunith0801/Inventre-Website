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
        breadcrumb={[
          { label: "Orders", href: "/admin/orders" },
          { label: "New order" },
        ]}
        title="Create order"
        description="Walk-in / phone order. Pick a customer and school, add items, capture payment offline."
      />
      <Card>
        <AdminOrderBuilder schools={schoolRows} />
      </Card>
    </div>
  );
}
