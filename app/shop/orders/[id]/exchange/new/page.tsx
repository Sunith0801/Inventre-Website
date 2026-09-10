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
  schools,
} from "@/db/schema";
import { getCurrentParent } from "@/server/session";
import { isExchangeTester, isExchangeOwnershipRelaxed } from "@/server/exchange-gate";
import { getParentOrderDetailFromErp } from "@/server/erp-customer-orders";
import {
  getHeldBackOrderItemIds,
  getLockedComponentSignatures,
  lockStateForUnit,
  classifyReturnItems,
  getBookkitParcelDelivered,
  getPendingComponentVariantIds,
} from "@/server/return-line-eligibility";
import {
  fallbackBundleComponents,
  loadBookkitCategoryTreeUnion,
  recoverMissingBookkitSelections,
  emptyContainerProductIds,
  loadBookkitCategoryTree,
  kindCategoryFor,
  resolveSubBundleCategories,
} from "@/server/bundle-fallback";
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
): Promise<{
  id: string;
  orderDelivered: boolean;
  deliveredAt: Date | null;
  /** The SAME order-detail object /shop/orders/[id] renders, so the picker
   *  can reuse its per-item / per-component badge status verbatim. */
  detail: Awaited<ReturnType<typeof getParentOrderDetailFromErp>>;
} | null> {
  // Ownership relaxed (all envs) — see isExchangeOwnershipRelaxed. Family
  // membership is the security boundary and is enforced below via
  // getParentOrderDetailFromErp (null → not this parent's family).
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
  // Family authorization (same boundary the button gate uses). We no longer
  // gate the FORM on order-level delivered/window — that's now decided
  // PER ITEM (item-wise model): a partially-delivered order must open the
  // form for its delivered items. Non-family → null → 404.
  const detail = await getParentOrderDetailFromErp(parentId, row.orderNumber);
  if (!detail) return null;
  const orderDelivered =
    row.status === "delivered" || detail.status === "delivered";
  const deliveredAt =
    row.deliveredAt ?? (detail.deliveredAt ? new Date(detail.deliveredAt) : null);
  return { id: row.id, orderDelivered, deliveredAt, detail };
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
  const resolved = await resolveLocalOrderId(decoded, me.id);
  if (!resolved) notFound();
  const orderId = resolved.id;

  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, schoolId: orders.schoolId })
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
  // A PARTIAL bundle_selections is the other half of the same problem: a box
  // whose uniforms were recorded but whose bookkit never was, so the parent
  // could exchange every uniform and not one book. Recover the book side from
  // the box definition. See recoverMissingBookkitSelections.
  const recoveredByItem = await recoverMissingBookkitSelections(
    items.map((it) => ({
      id: it.id,
      variantId: it.variantId ?? null,
      bundleSelections: it.bundleSelections,
    })),
  );
  const fallbackProductIds = new Set<string>();
  for (const comps of fallbackByItem.values())
    for (const c of comps) fallbackProductIds.add(c.productId);

  // Item-wise eligibility (2026-07-08): which order_items are delivered (and
  // therefore exchangeable). There is no time window — a delivered item stays
  // eligible forever.
  const itemElig = await classifyReturnItems(
    orderId,
    order.orderNumber,
    resolved.orderDelivered,
    resolved.deliveredAt,
  );
  // Nothing physically delivered yet → nothing to exchange (a fully-pending
  // order). Delivered items in a partially-shipped order still pass.
  if (![...itemElig.values()].some((e) => e.delivered)) notFound();

  // Cross-flow per-ITEM lock: order_items already in a NON-rejected exchange
  // OR missing request (freed only on rejection). Same Map shape the unit
  // builder expects (order_item_id → RTN/claim ref). Scoped to the order, so
  // a care-team request locks the item for the whole family.
  // Component-level lock (2026-07-09). A Magic Box is ONE order_item whose
  // components share its id, so the old order_item-level lock collapsed the
  // whole box once ANY component was requested. `lockByItem` resolves the lock
  // PER COMPONENT; the authoritative per-unit locked/lockReturnNumber/
  // someComponentsLocked are assigned in the post-pass just before render (the
  // inline `lockedByOrderItem` below is a base-lock-only compat default that
  // the post-pass overrides).
  const lockByItem = await getLockedComponentSignatures(orderId);
  const lockedByOrderItem = new Map<string, string | null>(
    [...lockByItem].filter(([, i]) => i.baseLocked).map(([oid, i]) => [oid, i.baseRef]),
  );

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

  // School name feeds the sub-bundle scoping vocabulary (the box name alone
  // says "SAS BP" but the matching sub-bundles are named for the school,
  // e.g. "SAS Suchitra Other" ← St. Andrews High School Suchitra).
  const [schoolRow] = order.schoolId
    ? await db
        .select({ name: schools.name })
        .from(schools)
        .where(eq(schools.id, order.schoolId))
        .limit(1)
    : [null as { name: string } | null];
  const schoolName = schoolRow?.name ?? null;

  // Non-uniform components nest under a single "Books" header so the picker
  // renders the three-level tree: Magic Box → Books → Text Books / Notebooks /
  // Other Items, with Uniforms as a sibling of Books.
  const BOOKS_GROUP = { key: "books", name: "Books" };
  const isUniformCat = (c: { name: string } | null | undefined) =>
    c?.name === "Uniforms";

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
    /** For a bookkit nested INSIDE a magic box: the bookkit's key+name, so the
     *  form nests its categories under a bookkit header. Absent on a standalone
     *  bookkit (the card itself is the bookkit) and on uniforms. */
    bookkitKey?: string | null;
    bookkitName?: string | null;
    locked: boolean;
    lockReturnNumber: string | null;
    /** Kit-parent only: SOME (but not all) components are already in a request.
     *  The box stays open for the rest, but the "whole box" option is disabled. */
    someComponentsLocked?: boolean;
    /** Bookkit book whose parcel hasn't arrived yet — shown greyed with a
     *  "not delivered yet" note, becomes selectable once the parcel lands. */
    notDelivered?: boolean;
    /** Kit-parent only: some components aren't delivered yet → "whole box"
     *  option disabled (you can't exchange a box that's only part-arrived). */
    someComponentsUndelivered?: boolean;
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
      // Sub-bundle categories for this box's components (Text Books /
      // Notebooks / Hindi / Other Items …), scoped to the box's school+grade.
      const fbSubCats = await resolveSubBundleCategories(
        fb.map((c) => c.productId).filter(Boolean),
        it.name,
        schoolName,
      );
      for (const c of fb) {
        const compVariants = variantsByProduct.get(c.productId) ?? [];
        const fbKind = effectiveKind(c.kind, c.name);
        // Prefer the real sub-bundle category; fall back to the coarse
        // kind-based bucket when the catalog can't place the component.
        const fbCat = fbSubCats.get(c.productId) ?? kindCategoryFor(fbKind, c.name);
        const fbBooks = fbCat && !isUniformCat(fbCat) ? BOOKS_GROUP : null;
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
          kind: fbKind,
          attributes: [],
          hasSiblings: compVariants.length > 0,
          siblings: compVariants,
          currentUnknown: true,
          categoryKey: fbCat?.key,
          categoryName: fbCat?.name,
          bookkitKey: fbBooks?.key,
          bookkitName: fbBooks?.name,
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
      // Sub-bundle categories for this box's stored components. A magic box
      // keeps its books FLAT here (no nested bookkit component), so without
      // this the 24 books render as one undifferentiated run.
      const rawProductIds: string[] = [];
      for (const c of raw) {
        const v = typeof c.variantId === "string" ? c.variantId : "";
        const pid = v ? productByVariant.get(v) : null;
        if (pid) rawProductIds.push(pid);
      }
      const rawSubCats = await resolveSubBundleCategories(
        rawProductIds,
        it.name,
        schoolName,
      );
      // Empty bookkit-category containers ("Bundle 1 Other" — a sub_bundle
      // with zero components, shown as "· Size Standard"). They name a group,
      // not a thing the parent received, so they must not appear as a
      // selectable line. See emptyContainerProductIds for the catalog cause.
      const emptyContainers = await emptyContainerProductIds(rawProductIds);

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
        // Drop the empty category container outright (see emptyContainers).
        const cPid = vid ? productByVariant.get(vid) ?? null : null;
        if (cPid && emptyContainers.has(cPid)) continue;
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
                  // The nested bookkit this leaf belongs to — lets the form
                  // group these categories under a bookkit header inside the
                  // magic box (instead of flat alongside the uniforms).
                  bookkitKey: `${ci}`,
                  bookkitName: compName,
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
        // Component axes (Colour / Size). `bundle_selections.attributes` is the
        // snapshot taken at checkout — but it is EMPTY on every box whose
        // composition was recovered by the audit backfill (2026-07-03: 1,642
        // boxes, `backfilledFromAudit: true`), which stored only
        // variantId/name/size. The form derives the colour AXIS from the
        // siblings when `attributes` is empty, but the ordered variant's own
        // colour then stayed "" while every sibling carried a real value, so
        // resolveVariantByAxes matched NOTHING and any size change fell back to
        // "That colour/size combination isn't available" — for sizes that are
        // active and in stock (SAL-ORD-2026-22600). Fall back to the same
        // catalog axes the siblings come from (exactly what the plain-item
        // branch below already does, and what the order page renders).
        const storedAttrs = Array.isArray(c.attributes)
          ? (c.attributes as { name: string; value: string }[])
          : [];
        const compAttrs =
          storedAttrs.length > 0
            ? storedAttrs
            : (allVariants.find((v) => v.id === vid)?.axes ?? []).map((a) => ({
                name: a.attributeName,
                value: a.value,
              }));
        const compSize = typeof c.size === "string" ? c.size : "";
        const compKind = effectiveKind(vid ? kindByVariant.get(vid) ?? null : null, compName);
        // Real sub-bundle category first (Text Books / Notebooks / …), then
        // the coarse kind-based bucket so uniform pieces still group.
        const compPid = vid ? productByVariant.get(vid) ?? null : null;
        const compCat =
          (compPid ? rawSubCats.get(compPid) : null) ??
          kindCategoryFor(compKind, compName);
        const compBooks = compCat && !isUniformCat(compCat) ? BOOKS_GROUP : null;
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
          kind: compKind,
          attributes: compAttrs,
          hasSiblings: siblings.length > 0,
          siblings,
          currentUnknown: false,
          categoryKey: compCat?.key,
          categoryName: compCat?.name,
          bookkitKey: compBooks?.key,
          bookkitName: compBooks?.name,
          locked: lockedByOrderItem.has(it.id),
          lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
        });
      }

      // The box's BOOK half, when the stored selections captured only the
      // uniforms (SAL-ORD-2026-33270). Same leaf shape as the nested-bookkit
      // branch above; `rec:` keeps the unitKey namespace distinct from the
      // `comp:${ci}:` keys minted off stored selections.
      for (const rec of recoveredByItem.get(it.id) ?? []) {
        const recCats = await loadBookkitCategoryTreeUnion(
          rec.variantIds,
          order.schoolId ?? null,
        );
        if (recCats.length > 0) {
          for (const cat of recCats) {
            for (const leaf of cat.items) {
              units.push({
                unitKey: `rec:${it.id}:${leaf.componentIndex}`,
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
                bookkitKey: `rec:${rec.componentProductId}`,
                bookkitName: rec.name,
                locked: lockedByOrderItem.has(it.id),
                lockReturnNumber: lockedByOrderItem.get(it.id) ?? null,
              });
            }
          }
          continue;
        }
        // No resolvable tree — offer the kit itself so the parent can still
        // raise a request against their books.
        const recKind = effectiveKind(null, rec.name);
        const recCat = kindCategoryFor(recKind, rec.name);
        units.push({
          unitKey: `rec:${it.id}:kit`,
          orderItemId: it.id,
          parentName: it.name,
          parentImage: it.image ?? null,
          parentHeadLabel: parentHead,
          isKitComponent: true,
          isKitParent: false,
          name: rec.name,
          size: "",
          qty: rec.qty,
          variantId: "",
          imageUrl: null,
          kind: recKind,
          attributes: [],
          hasSiblings: false,
          siblings: [],
          currentUnknown: true,
          categoryKey: recCat?.key,
          categoryName: recCat?.name,
          bookkitKey: BOOKS_GROUP.key,
          bookkitName: BOOKS_GROUP.name,
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

  // Authoritative per-unit lock post-pass (component-level). A Magic Box card
  // now collapses ONLY when the WHOLE box is out (kit-parent baseLocked); when
  // only some components are requested, the box stays open, those components
  // show locked, and the "whole box" option is disabled (someComponentsLocked).
  for (const u of units) {
    const st = lockStateForUnit(lockByItem.get(u.orderItemId), u);
    u.locked = st.locked;
    u.lockReturnNumber = st.ref;
    if (u.isKitParent) u.someComponentsLocked = st.someComponentsLocked;
  }

  // Drop held-back lines (out of stock / still out-for-delivery). The
  // customer doesn't have them yet — we already know and will ship them
  // later — so they can't be exchanged. Same per-item signal as the
  // order-page badge; kit / Magic-Box / bundle parents are never flagged.
  const heldBack = await getHeldBackOrderItemIds(orderId, order.orderNumber);

  // Magic-box BOOKKIT parcel gate (2026-07-09, revised). A magic box's books
  // ship in a separate bookkit parcel that often lands AFTER the uniforms —
  // while the order-level status already reads "delivered". The books stay
  // VISIBLE but are shown DISABLED with a "not delivered yet" note until their
  // parcel is delivered (they become selectable automatically once it lands).
  // null = no bookkit parcel info → don't gate.
  const bookkitDelivered = await getBookkitParcelDelivered(order.orderNumber);
  // A BOOK unit is one that nests under the "Books" header (`bookkitKey`) or is
  // kind='book'. NOT `categoryKey != null`: since the 3-level grouping work
  // (2026-07-20) EVERY component carries a categoryKey — uniform pieces get the
  // "Uniforms" bucket from `kindCategoryFor` — so the old test made the bookkit
  // gate grey out the uniforms too, leaving nothing selectable on any order
  // whose bookkit parcel wasn't delivered (e.g. SAL-ORD-2026-27372).
  // `bookkitKey` is set exactly for the non-uniform categories (line ~638).
  const isBookUnit = (u: (typeof units)[number]) =>
    u.isKitComponent && (u.bookkitKey != null || u.kind === "book");
  const undeliveredBookkit = bookkitDelivered === false;
  if (undeliveredBookkit) {
    for (const u of units) if (isBookUnit(u)) u.notDelivered = true;
    // A kit parent whose books aren't delivered can't be exchanged "whole box"
    // (part of it hasn't arrived) — flag it so the form disables that option.
    for (const u of units) {
      if (u.isKitParent) {
        u.someComponentsUndelivered = units.some(
          (c) => c.orderItemId === u.orderItemId && c.isKitComponent && c.notDelivered,
        );
      }
    }
  }

  // Magic-box UNIFORM/ACCESSORY per-component gate (2026-07-13). A box is one
  // order_item, so classifyReturnItems marks every component delivered via the
  // box's order-level flag. But uniform components dispatch as per-component
  // parcels (item_code == variant sku); a component with no delivered shipment
  // (e.g. an in-transit hoodie) is still pending. Grey those, matching audit.
  const pendingCompVars = await getPendingComponentVariantIds(
    orderId,
    order.orderNumber
  );
  if (pendingCompVars.size > 0) {
    for (const u of units) {
      if (u.isKitComponent && u.variantId && pendingCompVars.has(u.variantId.toLowerCase())) {
        u.notDelivered = true;
      }
    }
  }

  // Only DELIVERED, not-held-back items are exchangeable. A pending line isn't
  // in the customer's hands, so it must never be SELECTABLE — but it is still
  // SHOWN, disabled, with a "Pending delivery" note. Silently dropping it (the
  // behaviour until 2026-07-20) left the customer unable to tell the difference
  // between "this item can't be exchanged yet" and "we lost your item", and on
  // a wholly-undelivered order produced a bare 404. `delivered` is the
  // authoritative per-item signal from classifyReturnItems (per-line
  // outward_shipments, order-level fallback for bundle/bookkit parcels);
  // heldBack additionally covers a line marked delivered at the order level but
  // still lacking its own delivered shipment row, plus audit's packing_state
  // pin (out-of-stock / still-packing lines).
  for (const u of units) {
    if (!itemElig.get(u.orderItemId)?.delivered || heldBack.has(u.orderItemId)) {
      u.notDelivered = true;
    }
  }

  // ── BADGE PARITY (2026-07-27) ────────────────────────────────────────
  // Single source of truth: an item is selectable ONLY when the order page
  // badges it "delivered". Anything the order page shows as pending (or shows
  // no badge for) is NOT selectable here.
  //
  // Why: this page used to recompute delivery itself (classifyReturnItems +
  // getPendingComponentVariantIds + getHeldBackOrderItemIds), a strictly
  // POORER resolver than the one behind the order-page badge. The badge also
  // honours audit's packing_state pin, the per-category floor from
  // `derived_delivery_by_category`, and a base-name fallback that matches
  // blank-item_code (whole-parcel) rows. The picker's own gate bails out
  // entirely when a box isn't per-component "tracked" — measured on prod,
  // ~300 delivered boxes have per-component dispatch rows that don't
  // reconcile to any component sku/base-name, so nothing was gated and
  // pending pieces stayed selectable while the order page correctly showed
  // them Pending. Reusing the badge makes the two agree by construction.
  //
  // Applied as a UNION with the existing gates (never un-hides anything they
  // caught), so this can only ever be more conservative.
  {
    const norm = (s: string | null | undefined) =>
      (s ?? "").split(" · ")[0].trim().toLowerCase().replace(/\s+/g, " ");
    const compByVariant = new Map<string, string | null | undefined>();
    const compByName = new Map<string, string | null | undefined>();
    const lineByName = new Map<string, string | null | undefined>();
    for (const di of resolved.detail?.items ?? []) {
      const ln = norm(di.name);
      if (ln && !lineByName.has(ln)) lineByName.set(ln, di.status);
      for (const c of di.bundleSelections ?? []) {
        if (c.variantId) compByVariant.set(c.variantId.toLowerCase(), c.status);
        const cn = norm(c.name);
        if (cn && !compByName.has(cn)) compByName.set(cn, c.status);
      }
    }
    const badgeFor = (u: (typeof units)[number]) => {
      if (u.isKitComponent) {
        if (u.variantId && compByVariant.has(u.variantId.toLowerCase()))
          return compByVariant.get(u.variantId.toLowerCase());
        return compByName.get(norm(u.name));
      }
      return lineByName.get(norm(u.name));
    };
    for (const u of units) {
      if (u.isKitParent) continue; // header row, never selectable anyway
      const b = badgeFor(u);
      // `undefined` = the order page has no badge for this unit (it isn't
      // tracked at that granularity) → leave the existing gates to decide.
      // An explicit non-"delivered" badge blocks it.
      if (b !== undefined && b !== "delivered") u.notDelivered = true;
    }
  }

  const eligibleUnits = units;

  // Whole-box exchange is retired — a Magic Box is only ever exchangeable
  // item-by-item. A kit parent is a display header for its component rows, so
  // one whose components didn't survive (unresolvable composition) has nothing
  // under it: drop it, or it renders as a lone selectable "Whole box" row (and,
  // as the only unit, auto-selects via singleUnit). Components that are merely
  // PENDING still count as present — the parent must render so the customer can
  // see them listed as awaiting delivery.
  const hasComponents = new Set(
    eligibleUnits.filter((u) => u.isKitComponent).map((u) => u.orderItemId)
  );
  const selectableUnits = eligibleUnits.filter(
    (u) => !u.isKitParent || hasComponents.has(u.orderItemId)
  );
  // 404 only when there is genuinely nothing to show. If every unit is merely
  // pending, we render them disabled rather than 404-ing.
  if (selectableUnits.length === 0) notFound();

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
            units={selectableUnits}
          />
        </div>
      </div>
      <Footer />
    </main>
  );
}
