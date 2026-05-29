import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { suppliers } from "@/db/schema";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewPurchaseOrderForm } from "@/components/admin/NewPurchaseOrderForm";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  const sup = await db
    .select({ id: suppliers.id, name: suppliers.name, code: suppliers.supplierCode })
    .from(suppliers)
    .orderBy(asc(suppliers.name));

  return (
    <div className="max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Purchase orders", href: "/admin/purchase-orders" },
          { label: "New PO" },
        ]}
        title="New purchase order"
        description="Place an order with a supplier. Approve and convert to a Purchase Receipt when stock arrives."
      />
      <Card>
        <NewPurchaseOrderForm suppliers={sup} />
      </Card>
    </div>
  );
}
