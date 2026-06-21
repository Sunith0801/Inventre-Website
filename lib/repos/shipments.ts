import "server-only";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  shipments,
  shipmentItems,
  orderItems,
  orders,
  productVariants,
  products,
} from "@/db/schema";
import { shipItems, getDefaultWarehouseId } from "./inventory";
import { trackingUrlFor } from "../carriers";
import { notifyOrderStatus } from "../notifications";
import { allocShipmentNumber } from "../numbering";

/** SHP-{FY}-NNNNN — atomic via numbering_counters UPSERT. */
export async function generateShipmentNumber(): Promise<string> {
  return allocShipmentNumber();
}

export async function createShipment(args: {
  orderId: string;
  warehouseId?: string;
  items: { orderItemId: string; qty: number }[];
  carrier?: string;
  trackingNumber?: string;
  shippingAddress?: unknown;
  createdBy?: string;
}): Promise<{ id: string; shipmentNumber: string }> {
  const wh = args.warehouseId ?? (await getDefaultWarehouseId());
  const shipmentNumber = await generateShipmentNumber();

  // Validate that orderItems belong to the order and resolve variantIds.
  const orderItemRows = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.orderId, args.orderId),
        inArray(
          orderItems.id,
          args.items.map((i) => i.orderItemId)
        )
      )
    );
  if (orderItemRows.length !== args.items.length) {
    throw new Error("Invalid order items in shipment");
  }
  const orderItemById = new Map(orderItemRows.map((r) => [r.id, r]));

  const [shipment] = await db
    .insert(shipments)
    .values({
      orderId: args.orderId,
      shipmentNumber,
      warehouseId: wh,
      statusEnum: "draft",
      courier: args.carrier ?? null,
      trackingNumber: args.trackingNumber ?? null,
      trackingUrl:
        args.carrier && args.trackingNumber
          ? trackingUrlFor(args.carrier, args.trackingNumber)
          : null,
      shippingAddress: (args.shippingAddress as object) ?? null,
      createdBy: args.createdBy ?? null,
    })
    .returning();

  // ERP-imported sub-items can have NULL variant_id (no catalog match);
  // shipment_items requires a non-null variant. Refuse to ship a line
  // that can't be drawn from a real warehouse bin — ops needs to
  // resolve the SKU mapping first.
  const unmappedShipLines = args.items.filter((it) => {
    const oi = orderItemById.get(it.orderItemId);
    return oi && oi.variantId === null;
  });
  if (unmappedShipLines.length > 0) {
    throw new Error(
      `Cannot create shipment: ${unmappedShipLines.length} order item(s) have no local SKU (ERP-imported). Resolve the catalog mapping first.`
    );
  }
  await db.insert(shipmentItems).values(
    args.items.map((it) => {
      const oi = orderItemById.get(it.orderItemId)!;
      return {
        shipmentId: shipment.id,
        orderItemId: it.orderItemId,
        variantId: oi.variantId as string,
        qty: it.qty,
      };
    })
  );

  return { id: shipment.id, shipmentNumber };
}

/** Mark a shipment as shipped — decrements stock, fires SMS, advances order status. */
export async function markShipped(
  shipmentId: string,
  carrier: string,
  trackingNumber: string,
  createdBy?: string
): Promise<void> {
  const [ship] = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, shipmentId))
    .limit(1);
  if (!ship) throw new Error("Shipment not found");

  if (ship.statusEnum === "shipped" || ship.statusEnum === "delivered") {
    return; // idempotent
  }

  const items = await db
    .select()
    .from(shipmentItems)
    .where(eq(shipmentItems.shipmentId, shipmentId));

  // Stock-out from reserved → out
  await shipItems(
    shipmentId,
    items.map((it) => ({
      variantId: it.variantId,
      qty: it.qty,
      warehouseId: ship.warehouseId!,
    })),
    createdBy
  );

  await db
    .update(shipments)
    .set({
      statusEnum: "shipped",
      status: "shipped",
      courier: carrier,
      trackingNumber,
      trackingUrl: trackingUrlFor(carrier, trackingNumber),
      shippedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, shipmentId));

  // Advance order status if all items shipped.
  await maybeAdvanceOrderStatus(ship.orderId);

  void notifyOrderStatus(ship.orderId, "shipped");
}

export async function markDelivered(
  shipmentId: string,
  createdBy?: string
): Promise<void> {
  const [ship] = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, shipmentId))
    .limit(1);
  if (!ship) throw new Error("Shipment not found");
  if (ship.statusEnum === "delivered") return;

  await db
    .update(shipments)
    .set({
      statusEnum: "delivered",
      status: "delivered",
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, shipmentId));

  await maybeAdvanceOrderStatus(ship.orderId);
  void notifyOrderStatus(ship.orderId, "delivered");
}

/** Advance the parent order's status based on all its shipments + recompute %. */
async function maybeAdvanceOrderStatus(orderId: string) {
  const allShipments = await db
    .select()
    .from(shipments)
    .where(eq(shipments.orderId, orderId));
  if (allShipments.length === 0) return;

  const allDelivered = allShipments.every((s) => s.statusEnum === "delivered");
  const anyShipped = allShipments.some(
    (s) => s.statusEnum === "shipped" || s.statusEnum === "delivered"
  );

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (allDelivered) {
    update.status = "delivered";
    update.deliveredAt = new Date();
  } else if (anyShipped) {
    update.status = "shipped";
    update.shippedAt = new Date();
  }

  // Compute delivered_percent
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  if (totalQty > 0) {
    const shippedIds = allShipments
      .filter((s) => s.statusEnum === "shipped" || s.statusEnum === "delivered")
      .map((s) => s.id);
    let deliveredQty = 0;
    if (shippedIds.length > 0) {
      const sItems = await db
        .select()
        .from(shipmentItems)
        .where(inArray(shipmentItems.shipmentId, shippedIds));
      deliveredQty = sItems.reduce((s, i) => s + i.qty, 0);
    }
    update.deliveredPercent = Math.min(100, Math.round((deliveredQty / totalQty) * 100));
  }

  if (Object.keys(update).length > 1) {
    // Capture the prior status so we only re-notify audit on a real
    // fulfillment transition (not on a pure delivered_percent / updatedAt
    // touch), avoiding redundant queue rows.
    const [prior] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    await db.update(orders).set(update).where(eq(orders.id, orderId));
    if (
      typeof update.status === "string" &&
      prior &&
      prior.status !== update.status
    ) {
      // Re-emit so audit's Sales Order status / delivery_status reflect the
      // new fulfillment state (audit maps the inbound `status` string).
      // Without this, audit stays frozen at the create-time status. Buffered
      // queue, best-effort — never throws.
      const { enqueueOrderEvent } = await import("@/lib/erp-bridge");
      void enqueueOrderEvent(orderId, "order.updated");
    }
  }
}

export async function listShipments(filter: {
  status?: string;
  orderId?: string;
  limit?: number;
  schoolId?: string;
} = {}) {
  const conditions = [];
  if (filter.status) conditions.push(eq(shipments.statusEnum, filter.status as never));
  if (filter.orderId) conditions.push(eq(shipments.orderId, filter.orderId));
  if (filter.schoolId) conditions.push(eq(orders.schoolId, filter.schoolId));

  return db
    .select({
      shipment: shipments,
      orderNumber: orders.orderNumber,
    })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(shipments.createdAt))
    .limit(filter.limit ?? 100);
}

export async function getShipmentDetail(
  id: string,
  opts: { schoolId?: string } = {}
) {
  const [ship] = await db
    .select({
      shipment: shipments,
      order: orders,
    })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .where(eq(shipments.id, id))
    .limit(1);
  if (!ship) return null;
  if (opts.schoolId && ship.order.schoolId !== opts.schoolId) return null;

  const items = await db
    .select({
      item: shipmentItems,
      orderItem: orderItems,
      variant: productVariants,
      product: products,
    })
    .from(shipmentItems)
    .innerJoin(orderItems, eq(orderItems.id, shipmentItems.orderItemId))
    .innerJoin(productVariants, eq(productVariants.id, shipmentItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(shipmentItems.shipmentId, id));

  return {
    shipment: ship.shipment,
    orderNumber: ship.order.orderNumber,
    items: items.map((r) => ({
      id: r.item.id,
      productName: r.product.name,
      size: r.variant.size,
      sku: r.variant.sku,
      qty: r.item.qty,
    })),
  };
}
