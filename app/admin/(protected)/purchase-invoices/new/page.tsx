import { db } from "@/db/client";
import { suppliers, purchaseOrders } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewPurchaseInvoiceForm } from "@/components/admin/NewPurchaseInvoiceForm";

export const dynamic = "force-dynamic";

export default async function NewPurchaseInvoicePage() {
  const [supplierRows, openPOs] = await Promise.all([
    db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.status, "active"))
      .orderBy(asc(suppliers.name)),
    db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        supplierId: purchaseOrders.supplierId,
        grandTotal: purchaseOrders.grandTotal,
      })
      .from(purchaseOrders)
      .where(sql`${purchaseOrders.status} != 'cancelled'`)
      .orderBy(asc(purchaseOrders.poNumber)),
  ]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Buying", href: "/admin/purchase-invoices" },
          { label: "Purchase invoices", href: "/admin/purchase-invoices" },
          { label: "New" },
        ]}
        title="New purchase invoice"
        description="Record a bill received from a supplier. Optionally link to a PO."
      />
      <Card>
        <NewPurchaseInvoiceForm suppliers={supplierRows} purchaseOrders={openPOs} />
      </Card>
    </div>
  );
}
