import "server-only";
import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  payments,
  productVariants,
  products,
  productImages,
} from "@/db/schema";
import { safeImgUrl } from "@/lib/safe-url";

export async function generateOrderNumber(): Promise<string> {
  // Atomic — see lib/numbering.ts. Returns INV-{FY}-NNNNN, e.g. INV-26-27-00001.
  const { allocOrderNumber } = await import("@/server/numbering");
  return allocOrderNumber();
}

export type ParentOrderListItem = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
  itemCount: number;
  thumbUrl: string | null;
};

export async function listParentOrders(
  parentId: string
): Promise<ParentOrderListItem[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.parentId, parentId))
    .orderBy(desc(orders.createdAt));

  if (rows.length === 0) return [];
  const orderIds = rows.map((r) => r.id);
  const items = await db
    .select({
      orderId: orderItems.orderId,
      qty: orderItems.qty,
      productId: productVariants.productId,
    })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(inArray(orderItems.orderId, orderIds));

  const productIds = Array.from(new Set(items.map((i) => i.productId)));
  const imageRows = productIds.length
    ? await db
        .select()
        .from(productImages)
        .where(inArray(productImages.productId, productIds))
    : [];
  const firstImageByProduct = new Map<string, string>();
  imageRows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((i) => {
      if (!firstImageByProduct.has(i.productId))
        firstImageByProduct.set(i.productId, i.url);
    });

  return rows.map((o) => {
    const orderItemList = items.filter((i) => i.orderId === o.id);
    const itemCount = orderItemList.reduce((s, i) => s + i.qty, 0);
    const firstProductId = orderItemList[0]?.productId;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      total: Math.round(o.total / 100),
      createdAt: o.createdAt.toISOString(),
      itemCount,
      thumbUrl: firstProductId
        ? firstImageByProduct.get(firstProductId) ?? null
        : null,
    };
  });
}

export async function getParentOrderDetail(
  parentId: string,
  orderId: string
) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || order.parentId !== parentId) return null;

  const items = await db
    .select({
      item: orderItems,
      variant: productVariants,
      product: products,
    })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(orderItems.orderId, orderId));

  const productIds = items.map((i) => i.product.id);
  const imageRows = productIds.length
    ? await db
        .select()
        .from(productImages)
        .where(inArray(productImages.productId, productIds))
    : [];
  const firstImageByProduct = new Map<string, string>();
  imageRows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((i) => {
      if (!firstImageByProduct.has(i.productId))
        firstImageByProduct.set(i.productId, i.url);
    });

  const paymentRow = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    subtotal: Math.round(order.subtotal / 100),
    tax: Math.round(order.tax / 100),
    shipping: Math.round(order.shipping / 100),
    discount: Math.round(order.discount / 100),
    total: Math.round(order.total / 100),
    shippingAddress: order.shippingAddress as {
      receiverName: string;
      receiverPhone: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
    },
    placedAt: order.placedAt?.toISOString() ?? null,
    confirmedAt: order.confirmedAt?.toISOString() ?? null,
    shippedAt: order.shippedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    items: items.map((i) => ({
      id: i.item.id,
      name: i.item.nameSnapshot,
      size: i.item.size,
      qty: i.item.qty,
      unitPrice: Math.round(i.item.unitPrice / 100),
      total: Math.round(i.item.total / 100),
      imageUrl: safeImgUrl(firstImageByProduct.get(i.product.id) ?? "") ?? "",
    })),
    payment: paymentRow[0]
      ? {
          provider: paymentRow[0].provider,
          status: paymentRow[0].status,
          method: paymentRow[0].method,
        }
      : null,
  };
}
