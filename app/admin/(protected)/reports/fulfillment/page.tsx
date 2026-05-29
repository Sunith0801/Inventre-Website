import { sql, gte, and } from "drizzle-orm";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import {
  PageHeader,
  Card,
  CardHeader,
  Stat,
  SectionTitle,
} from "@/components/admin/ui/primitives";
import { Truck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FulfillmentReport() {
  const since = new Date(Date.now() - 30 * 86400_000);

  const [statusDist] = await db
    .select({
      placed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'placed')::int`,
      confirmed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'confirmed')::int`,
      packed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'packed')::int`,
      shipped: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'shipped')::int`,
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'delivered')::int`,
      cancelled: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'cancelled')::int`,
    })
    .from(orders)
    .where(gte(orders.createdAt, since));

  const [cycleTime] = await db
    .select({
      placedToConfirmed: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.confirmedAt} - ${orders.placedAt})) / 3600)`,
      confirmedToShipped: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.shippedAt} - ${orders.confirmedAt})) / 3600)`,
      shippedToDelivered: sql<number>`AVG(EXTRACT(EPOCH FROM (${orders.deliveredAt} - ${orders.shippedAt})) / 3600)`,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, since), sql`${orders.deliveredAt} IS NOT NULL`));

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Reports", href: "/admin/reports" },
          { label: "Fulfillment" },
        ]}
        title="Fulfillment report"
        description="Order-status distribution and cycle times across the lifecycle. Last 30 days."
      />

      <div className="mb-6">
        <SectionTitle description="Distribution of orders by their current status">
          Order status (last 30 days)
        </SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Stat label="Placed" value={statusDist?.placed ?? 0} iconTone="subtle" />
          <Stat label="Confirmed" value={statusDist?.confirmed ?? 0} iconTone="info" />
          <Stat label="Packed" value={statusDist?.packed ?? 0} iconTone="info" />
          <Stat label="Shipped" value={statusDist?.shipped ?? 0} iconTone="info" />
          <Stat label="Delivered" value={statusDist?.delivered ?? 0} iconTone="success" />
          <Stat label="Cancelled" value={statusDist?.cancelled ?? 0} iconTone="danger" />
        </div>
      </div>

      <div>
        <SectionTitle description="Average time orders take between status transitions">
          Cycle time
        </SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Stat
            label="Placed → Confirmed"
            value={`${Number(cycleTime?.placedToConfirmed ?? 0).toFixed(1)} h`}
            icon={Truck}
            iconTone="default"
          />
          <Stat
            label="Confirmed → Shipped"
            value={`${Number(cycleTime?.confirmedToShipped ?? 0).toFixed(1)} h`}
            icon={Truck}
            iconTone="default"
          />
          <Stat
            label="Shipped → Delivered"
            value={`${Number(cycleTime?.shippedToDelivered ?? 0).toFixed(1)} h`}
            icon={Truck}
            iconTone="success"
          />
        </div>
      </div>
    </div>
  );
}
