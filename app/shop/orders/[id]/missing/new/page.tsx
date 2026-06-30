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
} from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { isExchangeTester, isExchangeScopeRelaxed, isExchangeOwnershipRelaxed } from "@/lib/exchange-gate";
import { isOrderDeliveredForReturns } from "@/lib/return-eligibility";
import { findOpenRequestForOrder } from "@/lib/exchange";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { MissingForm } from "@/components/shop/orders/missing/MissingForm";
import { RequestBlockedNotice } from "@/components/shop/orders/RequestBlockedNotice";

/**
 * Customer-facing form for raising a missing-item claim.
 *
 * Order-level flow: load every exchangeable unit in the order
 * (standalone variants + every kit/Magic-Box component) and hand it to
 * the form as a flat list. The form lets the customer tick whichever
 * subset never arrived, with a per-unit qty input. One /api/missing
 * call covers everything ticked.
 */

export const dynamic = "force-dynamic";

async function resolveLocalOrderId(
  idOrNumber: string,
  parentId: string,
): Promise<string | null> {
  // Ownership relaxed (all envs) — see isExchangeOwnershipRelaxed. Family
  // membership is enforced by isOrderDeliveredForReturns below (→ notFound
  // for non-family orders), so resolving by id/number is safe.
  const ownerScope = isExchangeOwnershipRelaxed()
    ? undefined
    : eq(orders.parentId, parentId);
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  const [row] = isUuid
    ? await db
        .select({ id: orders.id, status: orders.status, orderNumber: orders.orderNumber, deliveredAt: orders.deliveredAt })
        .from(orders)
        .where(and(eq(orders.id, idOrNumber), ownerScope))
        .limit(1)
    : await db
        .select({ id: orders.id, status: orders.status, orderNumber: orders.orderNumber, deliveredAt: orders.deliveredAt })
        .from(orders)
        .where(and(eq(orders.orderNumber, idOrNumber), ownerScope))
        .limit(1);
  if (!row) return null;
  // Delivered gate matches the Report-missing button + submit handler:
  // delivered (local status OR mirror-derived) AND within the 15-day
  // window from delivery. (Was previously `status !== "placed"` here —
  // looser than both the button and createMissingClaim, which require
  // delivered — so the form could load on an undelivered order only to
  // have the submit 400.)
  const delivered = await isOrderDeliveredForReturns(
    parentId,
    row.orderNumber,
    row.status,
    row.deliveredAt ?? null
  );
  return delivered ? row.id : null;
}

export default async function NewMissingClaimPage({
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

  // Cross-flow lifetime lock: if a non-rejected missing OR exchange
  // request already exists for this order, the parent can't start a new
  // one — show the popup instead of the form. (Approved → permanent;
  // pending → "in progress". Dev relaxes the lock so testers can re-raise.)
  const blocker = isExchangeScopeRelaxed()
    ? null
    : await findOpenRequestForOrder(orderId, me.id);
  if (blocker) {
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
        </div>
        <RequestBlockedNotice
          flow="missing"
          existingKind={blocker.kind}
          existingStatus={blocker.status}
          orderHref={`/shop/orders/${id}`}
        />
        <Footer />
      </main>
    );
  }

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

  // Collect variant ids → product kinds for the category chip (so the
  // missing picker mirrors the exchange picker visually).
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

  // Axes for non-kit items (so the picker can show "Color: Navy · Size: M"
  // instead of bare size strings). Kit components already carry attributes
  // in bundle_selections.
  const standaloneVariantIds = items
    .filter((it) => {
      const raw = Array.isArray(it.bundleSelections) ? it.bundleSelections : [];
      return raw.length === 0 && it.variantId;
    })
    .map((it) => it.variantId!)
    .filter(Boolean);

  const axesByVariant = new Map<string, { name: string; value: string }[]>();
  if (standaloneVariantIds.length > 0) {
    const axisRows = await db
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
      .where(inArray(productVariantAttributes.variantId, standaloneVariantIds));
    for (const r of axisRows) {
      const arr = axesByVariant.get(r.variantId) ?? [];
      arr.push({ name: r.attributeName, value: r.value });
      axesByVariant.set(r.variantId, arr);
    }
  }

  const effectiveKind = (rawKind: string | null, name: string | null): string => {
    if (rawKind === "kit" && (name ?? "").toLowerCase().includes("bookkit")) return "book";
    return rawKind ?? "other";
  };

  type Unit = {
    unitKey: string;
    orderItemId: string;
    parentName: string;
    isKitComponent: boolean;
    isKitParent: boolean;
    name: string;
    size: string;
    qty: number;
    variantId: string;
    kind: string;
    attributes: { name: string; value: string }[];
  };

  const units: Unit[] = [];
  for (const it of items) {
    const raw = Array.isArray(it.bundleSelections)
      ? (it.bundleSelections as Array<Record<string, unknown>>)
      : [];
    if (raw.length > 0) {
      // Whole-kit unit first: the form's scope chooser offers "the whole
      // box never arrived" vs "only some items inside are missing".
      {
        const vid = it.variantId ?? "";
        units.push({
          unitKey: `kitparent:${it.id}`,
          orderItemId: it.id,
          parentName: it.name,
          isKitComponent: false,
          isKitParent: true,
          name: it.name,
          size: it.size,
          qty: it.qty,
          variantId: vid,
          kind: (vid ? kindByVariant.get(vid) : null) ?? "kit",
          attributes: [],
        });
      }
      raw.forEach((c, ci) => {
        const vid = typeof c.variantId === "string" ? c.variantId : "";
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
          isKitComponent: true,
          isKitParent: false,
          name: compName,
          size: compSize,
          qty: compQty,
          variantId: vid,
          kind: effectiveKind(vid ? kindByVariant.get(vid) ?? null : null, compName),
          attributes: compAttrs,
        });
      });
    } else {
      const vid = it.variantId ?? "";
      units.push({
        unitKey: `item:${it.id}`,
        orderItemId: it.id,
        parentName: it.name,
        isKitComponent: false,
        isKitParent: false,
        name: it.name,
        size: it.size,
        qty: it.qty,
        variantId: vid,
        kind: effectiveKind(vid ? kindByVariant.get(vid) ?? null : null, it.name),
        attributes: axesByVariant.get(vid) ?? [],
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
          Report a missing item
        </h1>
        <p className="mt-1 text-[13px] text-ink-500">
          For items that never arrived — not for damaged or wrong items (use exchange
          for those).
        </p>
        <div className="mt-6">
          <MissingForm
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
