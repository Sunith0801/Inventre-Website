import { db } from "@/db/client";
import { warehouses } from "@/db/schema";
import { asc } from "drizzle-orm";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { StockReconcileForm } from "@/components/admin/StockReconcileForm";

export const dynamic = "force-dynamic";

export default async function StockReconcilePage() {
  const whs = await db
    .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
    .from(warehouses)
    .orderBy(asc(warehouses.name));

  return (
    <div className="max-w-5xl">
      <PageHeader
        breadcrumb={[{ label: "Stock", href: "/admin/catalog/stock" }, { label: "Reconcile" }]}
        title="Stock reconciliation"
      />
      <Card>
        <StockReconcileForm warehouses={whs} />
      </Card>
    </div>
  );
}
