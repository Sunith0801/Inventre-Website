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
  schools,
} from "@/db/schema";
import { getCurrentParent } from "@/lib/session";
import { isExchangeTester, isExchangeOwnershipRelaxed } from "@/lib/exchange-gate";
import { getParentOrderDetailFromErp } from "@/lib/erp-customer-orders";
import {
  getHeldBackOrderItemIds,
  getLockedComponentSignatures,
  lockStateForUnit,
  classifyReturnItems,
  getBookkitParcelDelivered,
  getPendingComponentVariantIds,
} from "@/lib/return-line-eligibility";
import {
  fallbackBundleComponents,
  emptyContainerProductIds,
  loadBookkitCategoryTree,
  loadBookkitCategoryTreeUnion,
  recoverMissingBookkitSelections,
  kindCategoryFor,
  resolveSubBundleCategories,
} from "@/lib/bundle-fallback";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { MissingForm } from "@/components/shop/orders/missing/MissingForm";

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
): Promise<{
  id: string;
  orderDelivered: boolean;
  deliveredAt: Date | null;
  /** The SAME order-detail object /shop/orders/[id] renders, so the picker
   *  can reuse its per-item / per-component badge status verbatim. */
  detail: Awaited<ReturnType<typeof getParentOrderDetailFromErp>>;
} | null> {
  // Ownership relaxed (all envs) — see isExchangeOwnershipRelaxed. Family
  // membership is the security boundary, enforced below via
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
  // Family authorization only — the delivered/window gate is now PER ITEM
  // (item-wise): a partially-delivered order must open the form for its
  // delivered items. Non-family → null → 404.
  const detail = await getParentOrderDetailFromErp(parentId, row.orderNumber);
  if (!detail) return null;
  const orderDelivered =
    row.status === "delivered" || detail.status === "delivered";
  const deliveredAt =
    row.deliveredAt ?? (detail.deliveredAt ? new Date(detail.deliveredAt) : null);
  return { id: row.id, orderDelivered, deliveredAt, detail };
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
  const resolved = await resolveLocalOrderId(decoded, me.id);
  if (!resolved) notFound();
  const orderId = resolved.id;

  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, schoolId: orders.schoolId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) notFound();

  // Item-wise eligibility (2026-07-08): which order_items are delivered (and
  // therefore reportable). Cross-flow per-item lock (item already in a
  // non-rejected exchange OR missing request, freed only on rejection) is
  // applied as a post-pass over the built units below. There is no time
  // window — a delivered item stays eligible forever.
  const itemElig = await classifyReturnItems(
    orderId,
    order.orderNumber,
    resolved.orderDelivered,
    resolved.deliveredAt,
  );
  if (![...itemElig.values()].some((e) => e.delivered)) notFound();
  // Component-level lock (2026-07-09) — see exchange/new/page.tsx. Resolves the
  // lock PER COMPONENT so a Magic Box reopens for its still-eligible items; the
  // authoritative per-unit fields are set in the post-pass below.
  const lockByItem = await getLockedComponentSignatures(orderId);

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

  // See exchange/new/page.tsx — school name scopes the sub-bundle match.
  const [schoolRow] = order.schoolId
    ? await db
        .select({ name: schools.name })
        .from(schools)
        .where(eq(schools.id, order.schoolId))
        .limit(1)
    : [null as { name: string } | null];
  const schoolName = schoolRow?.name ?? null;

  const BOOKS_GROUP = { key: "books", name: "Books" };
  const isUniformCat = (c: { name: string } | null | undefined) =>
    c?.name === "Uniforms";

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
  // A PARTIAL bundle_selections is the other half of the same problem: a box
  // whose uniforms were recorded but whose bookkit never was. Recover the
  // book side from the definition so those books are reportable too.
  const recoveredByItem = await recoverMissingBookkitSelections(
    items.map((it) => ({
      id: it.id,
      variantId: it.variantId ?? null,
      bundleSelections: it.bundleSelections,
    })),
  );

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
    /** Nested-bookkit key+name (magic box only) — nests categories under a
     *  bookkit header. Absent on standalone bookkit + uniforms. */
    bookkitKey?: string | null;
    bookkitName?: string | null;
    // Item-wise state (set in a post-pass): locked = already in a
    // non-rejected request.
    locked?: boolean;
    lockReturnNumber?: string | null;
    /** Kit-parent only: some (not all) components already requested → box stays
     *  open but the "whole box" option is disabled. */
    someComponentsLocked?: boolean;
    /** Bookkit book whose parcel hasn't arrived — greyed "not delivered yet". */
    notDelivered?: boolean;
    /** Kit-parent only: some components not delivered → "whole box" disabled. */
    someComponentsUndelivered?: boolean;
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
      const fbSubCats = await resolveSubBundleCategories(
        fb.map((c) => c.productId).filter(Boolean),
        it.name,
        schoolName,
      );
      for (const c of fb) {
        const fbKind = effectiveKind(c.kind, c.name);
        // Real sub-bundle category first, then the coarse kind bucket.
        const fbCat = fbSubCats.get(c.productId) ?? kindCategoryFor(fbKind, c.name);
        const fbBooks = fbCat && !isUniformCat(fbCat) ? BOOKS_GROUP : null;
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
          kind: fbKind,
          attributes: [],
          categoryKey: fbCat?.key,
          categoryName: fbCat?.name,
          bookkitKey: fbBooks?.key,
          bookkitName: fbBooks?.name,
        });
      }
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

        // Hybrid: a bookkit component inside a magic box expands into its
        // category → book leaf units; uniform components stay flat.
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
                  bookkitKey: `${ci}`,
                  bookkitName: compName,
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
        const compKind = effectiveKind(vid ? kindByVariant.get(vid) ?? null : null, compName);
        const compPid = vid ? productByVariant.get(vid) ?? null : null;
        const compCat =
          (compPid ? rawSubCats.get(compPid) : null) ??
          kindCategoryFor(compKind, compName);
        const compBooks = compCat && !isUniformCat(compCat) ? BOOKS_GROUP : null;
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
          kind: compKind,
          attributes: compAttrs,
          categoryKey: compCat?.key,
          categoryName: compCat?.name,
          bookkitKey: compBooks?.key,
          bookkitName: compBooks?.name,
        });
      }

      // The box's BOOK half, when the stored selections captured only the
      // uniforms (SAL-ORD-2026-33270 — see recoverMissingBookkitSelections).
      // Without this the parent could report every uniform and not one book.
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
                bookkitKey: `rec:${rec.componentProductId}`,
                bookkitName: rec.name,
              });
            }
          }
          continue;
        }
        // No resolvable tree (bookkit with no components in the catalog) —
        // offer the kit itself so the parent can still report against it.
        const recKind = effectiveKind(null, rec.name);
        const recCat = kindCategoryFor(recKind, rec.name);
        units.push({
          unitKey: `rec:${it.id}:kit`,
          orderItemId: it.id,
          parentName: it.name,
          isKitComponent: true,
          isKitParent: false,
          name: rec.name,
          size: "",
          qty: rec.qty,
          variantId: "",
          kind: recKind,
          attributes: [],
          categoryKey: recCat?.key,
          categoryName: recCat?.name,
          bookkitKey: BOOKS_GROUP.key,
          bookkitName: BOOKS_GROUP.name,
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

  // Item-wise post-pass: tag each unit with its lock (already in a request) so
  // the form greys them. Lock is COMPONENT-level: a Magic Box collapses only
  // when the whole box is out; when only some components are claimed the box
  // stays open for the rest.
  for (const u of units) {
    const st = lockStateForUnit(lockByItem.get(u.orderItemId), u);
    u.locked = st.locked;
    u.lockReturnNumber = st.ref;
    if (u.isKitParent) u.someComponentsLocked = st.someComponentsLocked;
  }

  // Drop held-back lines (out of stock / still out-for-delivery). We already
  // know they didn't arrive and will ship them later, so they must not be
  // reportable as missing. Same per-item signal as the order-page badge.
  const heldBack = await getHeldBackOrderItemIds(orderId, order.orderNumber);

  // Magic-box BOOKKIT parcel gate (2026-07-09, revised) — mirror of exchange/new.
  // The books ship in a separate bookkit parcel; until it's delivered they
  // aren't "missing", they're still on the way. Keep them VISIBLE but DISABLED
  // with a "not delivered yet" note (selectable once the parcel lands). null =
  // no bookkit parcel info → don't gate.
  const bookkitDelivered = await getBookkitParcelDelivered(order.orderNumber);
  const undeliveredBookkit = bookkitDelivered === false;
  // A BOOK unit is one that nests under the "Books" header (`bookkitKey`) or is
  // kind='book'. NOT `categoryKey != null`: since the 3-level grouping work
  // (2026-07-20) EVERY component carries a categoryKey — uniform pieces get the
  // "Uniforms" bucket from `kindCategoryFor` — so the old test made the bookkit
  // gate grey out the uniforms too, leaving nothing selectable on any order
  // whose bookkit parcel wasn't delivered (e.g. SAL-ORD-2026-27372).
  // `bookkitKey` is set exactly for the non-uniform categories (line ~466).
  const isBookUnit = (u: (typeof units)[number]) =>
    u.isKitComponent && (u.bookkitKey != null || u.kind === "book");
  if (undeliveredBookkit) {
    for (const u of units) if (isBookUnit(u)) u.notDelivered = true;
    for (const u of units) {
      if (u.isKitParent) {
        u.someComponentsUndelivered = units.some(
          (c) => c.orderItemId === u.orderItemId && c.isKitComponent && c.notDelivered,
        );
      }
    }
  }

  // Magic-box UNIFORM/ACCESSORY per-component gate (2026-07-13) — mirror of
  // exchange/new. A uniform component with no delivered shipment (item_code ==
  // variant sku) is still on the way, so it can't be "missing" — grey it.
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

  // Only DELIVERED, not-held-back items can be reported missing. A pending /
  // not-yet-shipped line hasn't arrived, so it can't be "missing" (it's still
  // on the way) — it must never appear in the picker, even on a partially-
  // delivered order. `delivered` is the authoritative per-item signal from
  // classifyReturnItems; heldBack additionally covers a line marked delivered
  // at the order level but still lacking its own delivered shipment row.
  // Shown-but-disabled rather than filtered out (2026-07-20), matching the
  // exchange flow: the customer can see the pending lines and why they aren't
  // reportable yet, instead of them vanishing (or the page 404-ing).
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

  // Whole-box "never arrived" is retired — a Magic Box is only ever reportable
  // item-by-item. A kit parent whose components didn't survive has nothing
  // under it: drop it, or it renders as a lone selectable row (and, as the only
  // unit, auto-selects via singleUnit). Pending components still count as
  // present so the parent renders and lists them as awaiting delivery.
  const hasComponents = new Set(
    eligibleUnits.filter((u) => u.isKitComponent).map((u) => u.orderItemId)
  );
  const selectableUnits = eligibleUnits.filter(
    (u) => !u.isKitParent || hasComponents.has(u.orderItemId)
  );
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
            units={selectableUnits}
          />
        </div>
      </div>
      <Footer />
    </main>
  );
}
