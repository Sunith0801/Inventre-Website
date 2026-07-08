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
import { getHeldBackOrderItemIds } from "@/lib/return-line-eligibility";
import { fallbackBundleComponents, loadBookkitCategoryTree } from "@/lib/bundle-fallback";
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
    .select({ id: orders.id, orderNumber: orders.orderNumber, schoolId: orders.schoolId })
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
          flow="missing"
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

  // Fallback box composition for magic-box order items that never captured
  // their per-component picks into bundle_selections (~66% of them). Without
  // this the parent could only report the WHOLE box missing — never an
  // individual item inside it.
  const emptyBundleItemIds = items
    .filter(
      (it) =>
        !(
          Array.isArray(it.bundleSelections) &&
          it.bundleSelections.length > 0
        )
    )
    .map((it) => it.id);
  const fallbackByItem = await fallbackBundleComponents(emptyBundleItemIds);

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
    /** Bookkit drill-down grouping — see exchange page. Absent otherwise. */
    categoryKey?: string | null;
    categoryName?: string | null;
  };

  // Any nested kit (bookkit / "Book Set" / kind='kit') → category drill-down.
  // loadBookkitCategoryTree returns [] for flat/single-item kits → flat path.
  const isBookkitItem = (it: (typeof items)[number]): boolean => {
    const vid = it.variantId;
    const k = vid ? kindByVariant.get(vid) : null;
    return k === "kit";
  };

  const units: Unit[] = [];
  for (const it of items) {
    const raw = Array.isArray(it.bundleSelections)
      ? (it.bundleSelections as Array<Record<string, unknown>>)
      : [];
    const fb = fallbackByItem.get(it.id) ?? [];

    // ── Bookkit branch: whole-kit + per-category leaf books (3-level) ──
    if (isBookkitItem(it)) {
      const cats = await loadBookkitCategoryTree(
        it.variantId as string,
        order.schoolId ?? null,
      );
      if (cats.length > 0) {
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
        for (const cat of cats) {
          for (const leaf of cat.items) {
            units.push({
              unitKey: `comp:${it.id}:${leaf.componentIndex}`,
              orderItemId: it.id,
              parentName: it.name,
              isKitComponent: true,
              isKitParent: false,
              name: leaf.name,
              size: "",
              qty: leaf.qty,
              variantId: "",
              kind: effectiveKind(leaf.kind, leaf.name),
              attributes: [],
              categoryKey: cat.categoryKey,
              categoryName: cat.categoryName,
            });
          }
        }
        continue;
      }
    }
    if (raw.length === 0 && fb.length > 0) {
      // Recovered-composition path: whole-box unit + one unit per defined
      // component (size unknown — sourced from the bundle definition).
      units.push({
        unitKey: `kitparent:${it.id}`,
        orderItemId: it.id,
        parentName: it.name,
        isKitComponent: false,
        isKitParent: true,
        name: it.name,
        size: it.size,
        qty: it.qty,
        variantId: it.variantId ?? "",
        kind: (it.variantId ? kindByVariant.get(it.variantId) : null) ?? "kit",
        attributes: [],
      });
      fb.forEach((c) => {
        units.push({
          unitKey: `comp:${it.id}:${c.componentIndex}`,
          orderItemId: it.id,
          parentName: it.name,
          isKitComponent: true,
          isKitParent: false,
          name: c.name,
          size: "",
          qty: c.qty,
          variantId: "",
          kind: effectiveKind(c.kind, c.name),
          attributes: [],
        });
      });
      continue;
    }
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
      for (let ci = 0; ci < raw.length; ci++) {
        const c = raw[ci];
        const vid = typeof c.variantId === "string" ? c.variantId : "";
        const compName = typeof c.name === "string" ? c.name : "Component";
        const compQty = typeof c.qty === "number" ? c.qty : 1;

        // Hybrid: a bookkit component inside a magic box expands into its
        // category → book leaf units; uniform components stay flat.
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
                  isKitComponent: true,
                  isKitParent: false,
                  name: leaf.name,
                  size: "",
                  qty: leaf.qty,
                  variantId: "",
                  kind: effectiveKind(leaf.kind, leaf.name),
                  attributes: [],
                  categoryKey: cat.categoryKey,
                  categoryName: cat.categoryName,
                });
              }
            }
            continue;
          }
        }

        const compAttrs = Array.isArray(c.attributes)
          ? (c.attributes as { name: string; value: string }[])
          : [];
        const compSize = typeof c.size === "string" ? c.size : "";
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
      }
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

  // Drop held-back lines (out of stock / still out-for-delivery). We already
  // know they didn't arrive and will ship them later, so they must not be
  // reportable as missing. Same per-item signal as the order-page badge.
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
            units={eligibleUnits}
          />
        </div>
      </div>
      <Footer />
    </main>
  );
}
