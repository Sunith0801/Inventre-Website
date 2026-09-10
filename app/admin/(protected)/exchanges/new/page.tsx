import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { orders, orderItems } from "@/db/schema";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewExchangeForm } from "@/components/admin/NewExchangeForm";
import {
  requireAnyPermission,
  isResponse,
  assertSchoolAccess,
} from "@/server/admin-guard";

export const dynamic = "force-dynamic";

export default async function NewExchangePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  // Gate: must hold the SPOC exchange permission. A school_admin / SPOC is
  // further confined to their own school below.
  const guard = await requireAnyPermission(
    "spoc-exchange.read",
    "spoc-exchange.write"
  );
  if (isResponse(guard)) notFound();

  const { orderId } = await searchParams;

  if (!orderId) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          breadcrumb={[{ label: "Raise Exchange" }]}
          title="Raise an exchange"
          description="Open this from an order detail page (Actions → Raise exchange)."
        />
        <Card>
          <p className="text-[13px] text-ink-600">
            Pass <code className="font-mono">?orderId=…</code> to raise an
            exchange for a specific delivered order.
          </p>
        </Card>
      </div>
    );
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) notFound();

  // School confinement: a SPOC may only act on their own school's orders.
  // Hide existence (404) rather than 403 so cross-school orders aren't
  // enumerable. No-op for super/ops.
  if (assertSchoolAccess(guard, order.schoolId)) notFound();

  if (order.status !== "delivered") {
    return (
      <div className="max-w-2xl">
        <PageHeader
          breadcrumb={[
            { label: "Raise Exchange" },
            { label: `Order ${order.orderNumber}` },
          ]}
          title={`Order ${order.orderNumber}`}
          description="Exchanges can only be raised on delivered orders."
        />
        <Card>
          <p className="text-[13px] text-ink-600">
            This order is <strong>{order.status}</strong> — an exchange can only
            be raised once it is <strong>delivered</strong>.
          </p>
        </Card>
      </div>
    );
  }

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Raise Exchange" },
          { label: `Order ${order.orderNumber}` },
        ]}
        title={`Exchange for ${order.orderNumber}`}
        description="Pick which items the parent wants to exchange and the reason. The parent is notified by SMS and a pickup is scheduled automatically."
      />
      <Card>
        <NewExchangeForm
          orderId={order.id}
          orderNumber={order.orderNumber}
          items={items
            // ERP-imported sub-items without a local SKU can't be exchanged
            // (no catalog reference / variant binding). Show only real lines.
            .filter((i): i is typeof i & { variantId: string } => i.variantId !== null)
            .map((i) => ({
              id: i.id,
              variantId: i.variantId,
              name: i.nameSnapshot,
              size: i.size,
              qty: i.qty,
            }))}
        />
      </Card>
    </div>
  );
}
