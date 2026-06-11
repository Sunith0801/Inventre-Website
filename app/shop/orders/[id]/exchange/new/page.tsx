import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  orderItems,
  productVariants,
  products,
  productVariantAttributes,
  productAttributes,
  productAttributeValues,
  returns,
} from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { isExchangeTester, isExchangeScopeRelaxed } from "@/lib/exchange-gate";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ExchangeForm } from "@/components/shop/orders/exchange/ExchangeForm";

/**
 * Customer-facing form for raising an exchange request. Server-rendered
 * so the gate (parent session + EXCHANGE_TESTER_PHONES) is enforced
 * before any UI is sent — non-allowlisted parents see a 404 indistinct
 * from a wrong-URL hit.
 *
 * Order-level flow: instead of one form per order item, this loads
 * EVERY exchangeable unit in the order — each standalone variant + each
 * component inside any kit/Magic-Box — and hands them to the form as a
 * flat list. The form's per-unit-tab picker lets the customer flag any
 * subset across items, each with its own reason / replacement.
 */

export const dynamic = "force-dynamic";

async function resolveLocalOrderId(
  idOrNumber: string,
  parentId: string
): Promise<string | null> {
  // Dev: ownership scope relaxed — see isExchangeScopeRelaxed.
  const ownerScope = isExchangeScopeRelaxed()
    ? undefined
    : eq(orders.parentId, parentId);
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  if (isUuid) {
    const [row] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.id, idOrNumber), ownerScope))
      .limit(1);
    return row?.status === "delivered" ? row.id : null;
  }
  const [row] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(eq(orders.orderNumber, idOrNumber), ownerScope))
    .limit(1);
  return row?.status === "delivered" ? row.id : null;
}

type SiblingLite = {
  id: string;
  productId: string;
  size: string;
  sku: string;
  imageUrl: string | null;
  isActive: boolean;
  stockQty: number;
  axes: { attributeName: string; value: string }[];
};

export default async function NewExchangePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentParent();
  if (!me) notFound();
  if (!isExchangeTester(me.phone)) notFound();

  const { id } = await params;

  const decoded = decodeURIComponent(id);
  const orderId = await resolveLocalOrderId(decoded, me.id);
  if (!orderId) notFound();

  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) notFound();

  const items = await db
    .select({
      id: orderItems.id,
      name: orderItems.nameSnapshot,
      size: orderItems.size,
      qty: orderItems.qty,
      image: orderItems.imageSnapshot,
      variantId: orderItems.variantId,
      bundleSelections: orderItems.bundleSelections,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  if (items.length === 0) notFound();

  // Lookup any active exchanges so we can mark already-locked order_items
  // in the picker (matches the per-order-item gate in lib/exchange.ts).
  const activeRets = await db
    .select({
      returnNumber: returns.returnNumber,
      itemIds: returns.itemIds,
      status: returns.status,
      kind: returns.kind,
    })
    .from(returns)
    .where(and(eq(returns.orderId, orderId), eq(returns.parentId, me.id)));
  const lockedByOrderItem = new Map<string, string | null>();
  for (const r of activeRets) {
    if (r.kind !== "exchange") continue;
    if (r.status !== "requested" && r.status !== "approved") continue;
    const ids = Array.isArray(r.itemIds) ? (r.itemIds as string[]) : [];
    for (const oid of ids) {
      if (!lockedByOrderItem.has(oid)) {
        lockedByOrderItem.set(oid, r.returnNumber ?? null);
      }
    }
  }

  // Collect every variantId we need siblings for — both the parent
  // variantIds (non-kit items) AND every kit-component variantId.
  const allVariantIds = new Set<string>();
  for (const it of items) {
    if (it.variantId) allVariantIds.add(it.variantId);
    const raw = Array.isArray(it.bundleSelections)
      ? (it.bundleSelections as Array<Record<string, unknown>>)
      : [];
    for (const c of raw) {
      const vid = typeof c.variantId === "string" ? c.variantId : null;
      if (vid && /^[0-9a-f-]{36}$/i.test(vid)) allVariantIds.add(vid);
    }
  }

  // Map each variantId → productId + kind so we can look up siblings
  // by product (siblings live on the same product).
  const kindByVariant = new Map<string, string>();
  const productByVariant = new Map<string, string>();
  if (allVariantIds.size > 0) {
    const kindRows = await db
      .select({
        variantId: productVariants.id,
        kind: products.kind,
        productId: products.id,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, Array.from(allVariantIds)));
    for (const r of kindRows) {
      if (r.kind) kindByVariant.set(r.variantId, r.kind);
      productByVariant.set(r.variantId, r.productId);
    }
  }

  // Per-product variant list (each row's siblings = same-product variants).
  const productIds = Array.from(new Set(productByVariant.values()));
  const variantsByProduct = new Map<string, SiblingLite[]>();
  if (productIds.length > 0) {
    const variantRows = await db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        size: productVariants.size,
        sku: productVariants.sku,
        imageUrl: productVariants.imageUrl,
        isActive: productVariants.isActive,
        stockQty: productVariants.stockQty,
      })
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds));

    const allVariantIdsForAxes = variantRows.map((v) => v.id);
    const axisRows = allVariantIdsForAxes.length > 0
      ? await db
          .select({
            variantId: productVariantAttributes.variantId,
            attributeName: productAttributes.name,
            value: productAttributeValues.value,
          })
          .from(productVariantAttributes)
          .innerJoin(
            productAttributes,
            eq(productAttributes.id, productVariantAttributes.attributeId)
          )
          .innerJoin(
            productAttributeValues,
            eq(productAttributeValues.id, productVariantAttributes.valueId)
          )
          .where(inArray(productVariantAttributes.variantId, allVariantIdsForAxes))
      : [];
    const axesByVariant = new Map<string, { attributeName: string; value: string }[]>();
    for (const r of axisRows) {
      const arr = axesByVariant.get(r.variantId) ?? [];
      arr.push({ attributeName: r.attributeName, value: r.value });
      axesByVariant.set(r.variantId, arr);
    }
    for (const v of variantRows) {
      const arr = variantsByProduct.get(v.productId) ?? [];
      arr.push({
        id: v.id,
        productId: v.productId,
        size: v.size,
        sku: v.sku,
        imageUrl: v.imageUrl,
        isActive: v.isActive,
        stockQty: v.stockQty,
        axes: axesByVariant.get(v.id) ?? [],
      });
      variantsByProduct.set(v.productId, arr);
    }
  }

  // Heuristic to keep bookkits flowing through "book" reasons even
  // though products.kind is "kit". Matches the form-side override.
  const effectiveKind = (rawKind: string | null, name: string | null): string => {
    if (rawKind === "kit" && (name ?? "").toLowerCase().includes("bookkit")) return "book";
    return rawKind ?? "other";
  };

  // Build the flat units list. For each order item:
  //   - if it has bundle_selections → emit one unit per kit component
  //   - otherwise → emit one unit for the order item itself
  type Unit = {
    unitKey: string;
    orderItemId: string;
    parentName: string;
    parentImage: string | null;
    parentHeadLabel: string;
    isKitComponent: boolean;
    isKitParent: boolean;
    name: string;
    size: string;
    qty: number;
    variantId: string;
    imageUrl: string | null;
    kind: string;
    attributes: { name: string; value: string }[];
    hasSiblings: boolean;
    siblings: SiblingLite[];
    locked: boolean;
    lockReturnNumber: string | null;
  };

  const units: Unit[] = [];
  for (const it of items) {
    const parentHead = it.size ? `Size ${it.size}` : "";
    const raw = Array.isArray(it.bundleSelections)
      ? (it.bundleSelections as Array<Record<string, unknown>>)
      : [];
    if (raw.length > 0) {
      // Whole-kit unit first: the form's scope chooser offers "exchange
      // the whole box" vs "only some items inside". Kit-level reasons
      // (contents don't match / arrived damaged / …) apply here, so the
      // raw kind is used — the bookkit→book override stays component-only.
      {
        const vid = it.variantId ?? "";
        const productId = vid ? productByVariant.get(vid) ?? null : null;
        const allVariants = productId ? variantsByProduct.get(productId) ?? [] : [];
        const siblings = vid ? allVariants.filter((v) => v.id !== vid) : [];
        units.push({
          unitKey: `kitparent:${it.id}`,
          orderItemId: it.id,
          parentName: it.name,
          parentImage: it.image ?? null,
          parentHeadLabel: parentHead,
          isKitComponent: false,
          isKitParent: true,
          name: it.name,
          size: it.size,
          qty: it.qty,
          variantId: vid,
          imageUrl: it.image ?? null,
          kind: (vid ? kindByVariant.get(vid) : null) ?? "kit",
          attributes: [],
          hasSiblings: siblings.length > 0,
          siblings,
          locked: lockedByOrderItem.has(it.id),
          lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
        });
      }
      raw.forEach((c, ci) => {
        const vid = typeof c.variantId === "string" ? c.variantId : "";
        const productId = vid ? productByVariant.get(vid) ?? null : null;
        const allVariants = productId ? variantsByProduct.get(productId) ?? [] : [];
        const siblings = vid ? allVariants.filter((v) => v.id !== vid) : [];
        const compName = typeof c.name === "string" ? c.name : "Component";
        const compAttrs = Array.isArray(c.attributes)
          ? (c.attributes as { name: string; value: string }[])
          : [];
        const compSize = typeof c.size === "string" ? c.size : "";
        const compQty = typeof c.qty === "number" ? c.qty : 1;
        units.push({
          unitKey: `comp:${it.id}:${ci}`,
          orderItemId: it.id,
          parentName: it.name,
          parentImage: it.image ?? null,
          parentHeadLabel: parentHead,
          isKitComponent: true,
          isKitParent: false,
          name: compName,
          size: compSize,
          qty: compQty,
          variantId: vid,
          imageUrl: null,
          kind: effectiveKind(vid ? kindByVariant.get(vid) ?? null : null, compName),
          attributes: compAttrs,
          hasSiblings: siblings.length > 0,
          siblings,
          locked: lockedByOrderItem.has(it.id),
          lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
        });
      });
    } else {
      const vid = it.variantId ?? "";
      const productId = vid ? productByVariant.get(vid) ?? null : null;
      const allVariants = productId ? variantsByProduct.get(productId) ?? [] : [];
      const siblings = vid ? allVariants.filter((v) => v.id !== vid) : [];
      const itAxes = vid
        ? (allVariants.find((v) => v.id === vid)?.axes ?? []).map((a) => ({
            name: a.attributeName,
            value: a.value,
          }))
        : [];
      units.push({
        unitKey: `item:${it.id}`,
        orderItemId: it.id,
        parentName: it.name,
        parentImage: it.image ?? null,
        parentHeadLabel: parentHead,
        isKitComponent: false,
        isKitParent: false,
        name: it.name,
        size: it.size,
        qty: it.qty,
        variantId: vid,
        imageUrl: it.image ?? null,
        kind: effectiveKind(vid ? kindByVariant.get(vid) ?? null : null, it.name),
        attributes: itAxes,
        hasSiblings: siblings.length > 0,
        siblings,
        locked: lockedByOrderItem.has(it.id),
        lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
      });
    }
  }

  if (units.length === 0) notFound();

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-8 pb-16">
        <a
          href={`/shop/orders/${id}`}
          className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
        >
          ← Back to order
        </a>
        <h1 className="mt-4 font-display text-[28px] font-extrabold text-ink-900">
          Request an exchange
        </h1>
        <p className="mt-1 text-[13px] text-ink-500">
          Pick every item that has a problem — we&apos;ll handle them together.
        </p>
        <div className="mt-6">
          <ExchangeForm
            orderId={orderId}
            orderNumber={order.orderNumber}
            units={units}
          />
        </div>
      </div>
      <Footer />
    </main>
  );
}
