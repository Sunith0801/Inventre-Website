import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { orders, orderItems } from "@/db/schema";
import { PageHeader, Card } from "@/components/admin/ui/primitives";
import { NewReturnForm } from "@/components/admin/NewReturnForm";

export const dynamic = "force-dynamic";

export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;

  if (!orderId) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          breadcrumb={[
            { label: "Returns", href: "/admin/returns" },
            { label: "New return" },
          ]}
          title="Start a return"
          description="Open this from an order detail page (Actions → Start return)."
        />
        <Card>
          <p className="text-[13px] text-ink-600">
            Pass <code className="font-mono">?orderId=…</code> to start a return
            for a specific order.
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

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Returns", href: "/admin/returns" },
          { label: `Order ${order.orderNumber}` },
          { label: "New return" },
        ]}
        title={`Return for ${order.orderNumber}`}
        description="Pick which items the customer is returning and the reason. The refund amount is computed from the original line totals."
      />
      <Card>
        <NewReturnForm
          orderId={order.id}
          orderNumber={order.orderNumber}
          items={items
            // ERP-imported sub-items without a local SKU can't be
            // returned through this flow (no catalog reference, no
            // inventory binning). Drop them so the form only shows
            // returnable lines.
            .filter((i): i is typeof i & { variantId: string } => i.variantId !== null)
            .map((i) => ({
              id: i.id,
              variantId: i.variantId,
              name: i.nameSnapshot,
              size: i.size,
              qty: i.qty,
              total: i.total,
            }))}
        />
      </Card>
    </div>
  );
}
