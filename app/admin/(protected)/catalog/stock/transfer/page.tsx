import { db } from "@/db/client";
import { warehouses } from "@/db/schema";
import { asc } from "drizzle-orm";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { StockTransferForm } from "@/components/admin/StockTransferForm";

export const dynamic = "force-dynamic";

export default async function StockTransferPage() {
  const whs = await db
    .select({ id: warehouses.id, name: warehouses.name, isDefault: warehouses.isDefault })
    .from(warehouses)
    .orderBy(asc(warehouses.name));

  return (
    <div className="max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "Catalog", href: "/admin/catalog/stock" },
          { label: "Stock", href: "/admin/catalog/stock" },
          { label: "Transfer" },
        ]}
        title="Stock transfer"
        description="Move inventory between warehouses. Each line writes paired ledger rows (transfer_out / transfer_in) referencing each other."
      />
      <Card>
        <StockTransferForm warehouses={whs} />
      </Card>
    </div>
  );
}
