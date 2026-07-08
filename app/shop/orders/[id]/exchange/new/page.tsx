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
import { isExchangeTester, isExchangeScopeRelaxed, isExchangeOwnershipRelaxed } from "@/lib/exchange-gate";
import { isOrderDeliveredForReturns } from "@/lib/return-eligibility";
import { getHeldBackOrderItemIds } from "@/lib/return-line-eligibility";
import { fallbackBundleComponents, loadBookkitCategoryTree } from "@/lib/bundle-fallback";
import { findOpenRequestForOrder } from "@/lib/exchange";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ExchangeForm } from "@/components/shop/orders/exchange/ExchangeForm";
import { RequestBlockedNotice } from "@/components/shop/orders/RequestBlockedNotice";

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
  // Delivered gate matches the Request-exchange button: delivered (local
  // status OR mirror-derived) AND within the 15-day window from delivery.
  // See isOrderDeliveredForReturns.
  const delivered = await isOrderDeliveredForReturns(
    parentId,
    row.orderNumber,
    row.status,
    row.deliveredAt ?? null
  );
  return delivered ? row.id : null;
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
    .select({ id: orders.id, orderNumber: orders.orderNumber, schoolId: orders.schoolId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) notFound();

  // Cross-flow lifetime lock: if a non-rejected exchange OR missing
  // request already exists for this order, the parent can't start a new
  // one — show the popup instead of the form. (Approved → permanent;
  // pending → "in progress". Dev relaxes the lock so testers can re-raise.)
  const blocker = isExchangeScopeRelaxed()
    ? null
    : await findOpenRequestForOrder(orderId);
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
          flow="exchange"
          existingKind={blocker.kind}
          existingStatus={blocker.status}
          existingSource={blocker.source}
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

  // Fallback box composition for magic-box order items that never stored
  // their per-component picks in bundle_selections (~66%). Lets the parent
  // exchange an individual item inside the box instead of only the whole
  // box. The exact size isn't recoverable from the bundle definition, so
  // those components are flagged `currentUnknown` and the form asks the
  // parent which size they currently have.
  const emptyBundleItemIds = items
    .filter(
      (it) =>
        !(Array.isArray(it.bundleSelections) && it.bundleSelections.length > 0)
    )
    .map((it) => it.id);
  const fallbackByItem = await fallbackBundleComponents(emptyBundleItemIds);
  const fallbackProductIds = new Set<string>();
  for (const comps of fallbackByItem.values())
    for (const c of comps) fallbackProductIds.add(c.productId);

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
  // Include fallback component products so recovered-composition components
  // get their full size/variant list for the swap picker.
  const productIds = Array.from(
    new Set([...productByVariant.values(), ...fallbackProductIds])
  );
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
    /** True when this component's exact ordered variant/size is unknown
     *  (recovered from the bundle definition). The form asks the parent
     *  which size they currently have before the swap. */
    currentUnknown: boolean;
    /** Bookkit drill-down grouping: which category (sub_bundle) this leaf
     *  book sits under. Absent on non-bookkit units. */
    categoryKey?: string | null;
    categoryName?: string | null;
    locked: boolean;
    lockReturnNumber: string | null;
  };

  // A nested kit (bookkit, "Book Set", or any products.kind='kit') has
  // CATEGORIES (sub_bundles) of leaf books — a 3-level tree the flat
  // bundle_selections/fallback paths collapse. For these we emit one
  // whole-kit unit + one leaf unit per book, tagged with its category, so
  // the form offers whole-kit / whole-category / individual-book. Applies to
  // ALL kits (not just name~"bookkit"); loadBookkitCategoryTree returns []
  // for flat / single-item kits, which then fall through to the flat path.
  const isBookkitItem = (it: (typeof items)[number]): boolean => {
    const vid = it.variantId;
    const k = vid ? kindByVariant.get(vid) : null;
    return k === "kit";
  };

  const units: Unit[] = [];
  for (const it of items) {
    const parentHead = it.size ? `Size ${it.size}` : "";
    const raw = Array.isArray(it.bundleSelections)
      ? (it.bundleSelections as Array<Record<string, unknown>>)
      : [];
    const fb = fallbackByItem.get(it.id) ?? [];

    // ── Bookkit branch: whole-kit + per-category leaf books ──────────
    if (isBookkitItem(it)) {
      const cats = await loadBookkitCategoryTree(
        it.variantId as string,
        order.schoolId ?? null
      );
      if (cats.length > 0) {
        const vid = it.variantId ?? "";
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
          hasSiblings: false,
          siblings: [],
          currentUnknown: false,
          categoryKey: null,
          categoryName: null,
          locked: lockedByOrderItem.has(it.id),
          lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
        });
        for (const cat of cats) {
          for (const leaf of cat.items) {
            units.push({
              unitKey: `comp:${it.id}:${leaf.componentIndex}`,
              orderItemId: it.id,
              parentName: it.name,
              parentImage: it.image ?? null,
              parentHeadLabel: parentHead,
              isKitComponent: true,
              isKitParent: false,
              name: leaf.name,
              size: "",
              qty: leaf.qty,
              variantId: "",
              imageUrl: null,
              // Leaf books flow through "book" reasons regardless of the
              // catalog kind (matches effectiveKind); "just capture the
              // book" — no size picker, so no siblings / currentUnknown.
              kind: effectiveKind(leaf.kind, leaf.name),
              attributes: [],
              hasSiblings: false,
              siblings: [],
              currentUnknown: false,
              categoryKey: cat.categoryKey,
              categoryName: cat.categoryName,
              locked: lockedByOrderItem.has(it.id),
              lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
            });
          }
        }
        continue;
      }
      // No resolvable categories → fall through to the flat paths below.
    }
    if (raw.length === 0 && fb.length > 0) {
      // Recovered-composition path: whole-box unit + one unit per defined
      // component. Each component lists ALL variants of its product as swap
      // targets (we don't know which the parent has → currentUnknown).
      const vid = it.variantId ?? "";
      const parentProductId = vid ? productByVariant.get(vid) ?? null : null;
      const parentVariants = parentProductId
        ? variantsByProduct.get(parentProductId) ?? []
        : [];
      const parentSiblings = vid
        ? parentVariants.filter((v) => v.id !== vid)
        : [];
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
        hasSiblings: parentSiblings.length > 0,
        siblings: parentSiblings,
        currentUnknown: false,
        locked: lockedByOrderItem.has(it.id),
        lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
      });
      for (const c of fb) {
        const compVariants = variantsByProduct.get(c.productId) ?? [];
        units.push({
          unitKey: `comp:${it.id}:${c.componentIndex}`,
          orderItemId: it.id,
          parentName: it.name,
          parentImage: it.image ?? null,
          parentHeadLabel: parentHead,
          isKitComponent: true,
          isKitParent: false,
          name: c.name,
          size: "",
          qty: c.qty,
          variantId: "",
          imageUrl: null,
          kind: effectiveKind(c.kind, c.name),
          attributes: [],
          hasSiblings: compVariants.length > 0,
          siblings: compVariants,
          currentUnknown: true,
          locked: lockedByOrderItem.has(it.id),
          lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
        });
      }
      continue;
    }
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
          currentUnknown: false,
          locked: lockedByOrderItem.has(it.id),
          lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
        });
      }
      for (let ci = 0; ci < raw.length; ci++) {
        const c = raw[ci];
        const vid = typeof c.variantId === "string" ? c.variantId : "";
        const compName = typeof c.name === "string" ? c.name : "Component";
        const compQty = typeof c.qty === "number" ? c.qty : 1;

        // Hybrid: a component that is itself a nested kit (a bookkit sitting
        // inside a magic box) expands into its category → book leaf units,
        // so the parent can drill into individual books. Uniform components
        // stay flat below (their ordered size matters).
        const cKind = vid ? kindByVariant.get(vid) ?? null : null;
        if (cKind === "kit" && /^[0-9a-f-]{36}$/i.test(vid)) {
          const subCats = await loadBookkitCategoryTree(vid, order.schoolId ?? null);
          if (subCats.length > 0) {
            for (const cat of subCats) {
              for (const leaf of cat.items) {
                units.push({
                  unitKey: `comp:${it.id}:${ci}:${leaf.componentIndex}`,
                  orderItemId: it.id,
                  parentName: it.name,
                  parentImage: it.image ?? null,
                  parentHeadLabel: parentHead,
                  isKitComponent: true,
                  isKitParent: false,
                  name: leaf.name,
                  size: "",
                  qty: leaf.qty,
                  variantId: "",
                  imageUrl: null,
                  kind: effectiveKind(leaf.kind, leaf.name),
                  attributes: [],
                  hasSiblings: false,
                  siblings: [],
                  currentUnknown: false,
                  categoryKey: cat.categoryKey,
                  categoryName: cat.categoryName,
                  locked: lockedByOrderItem.has(it.id),
                  lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
                });
              }
            }
            continue;
          }
        }

        // Flat component (uniform pieces, single items) — unchanged.
        const productId = vid ? productByVariant.get(vid) ?? null : null;
        const allVariants = productId ? variantsByProduct.get(productId) ?? [] : [];
        const siblings = vid ? allVariants.filter((v) => v.id !== vid) : [];
        const compAttrs = Array.isArray(c.attributes)
          ? (c.attributes as { name: string; value: string }[])
          : [];
        const compSize = typeof c.size === "string" ? c.size : "";
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
          currentUnknown: false,
          locked: lockedByOrderItem.has(it.id),
          lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
        });
      }
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
        currentUnknown: false,
        locked: lockedByOrderItem.has(it.id),
        lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
      });
    }
  }

  if (units.length === 0) notFound();

  // Drop held-back lines (out of stock / still out-for-delivery). The
  // customer doesn't have them yet — we already know and will ship them
  // later — so they can't be exchanged. Same per-item signal as the
  // order-page badge; kit / Magic-Box / bundle parents are never flagged.
  const heldBack = await getHeldBackOrderItemIds(orderId, order.orderNumber);
  const eligibleUnits = units.filter((u) => !heldBack.has(u.orderItemId));
  if (eligibleUnits.length === 0) notFound();

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
            units={eligibleUnits}
          />
        </div>
      </div>
      <Footer />
    </main>
  );
}
