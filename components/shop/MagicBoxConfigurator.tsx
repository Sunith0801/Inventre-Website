"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Loader2, ShoppingBag, AlertCircle, ShoppingCart, Package, Ruler, X } from "lucide-react";
import type { BundleNode } from "@/lib/repos/products";
import { useCart } from "@/lib/cart";
import { parseBookkitLangs, type LangPair } from "@/lib/bookkit-langs";
import { MultiAttributePicker } from "@/components/shop/pdp/MultiAttributePicker";
import { SizeGuideTable } from "@/components/shop/pdp/SizeGuideTable";

/**
 * Reverse the `variantsByAttributeKey` map for a given variantId: returns
 * the per-axis selection that resolves to that variant, or null if the
 * variant isn't in the map. Used to pre-fill the multi-axis picker when
 * we're restoring picks from either a saved draft or the existing cart.
 */
function selectionFromVariantId(
  variantsByAttributeKey: Record<string, string>,
  variantId: string,
): Record<string, string> | null {
  for (const [key, vid] of Object.entries(variantsByAttributeKey)) {
    if (vid !== variantId) continue;
    try {
      const pairs = JSON.parse(key) as [string, string][];
      return Object.fromEntries(pairs);
    } catch {
      return null;
    }
  }
  return null;
}

// ── House-colour consistency check ───────────────────────────────────
// Scoped to specific Magic Boxes only. For these boxes we warn when the
// parent picks different house colours across the configurable items —
// a uniform set should be one house colour (Ruby/Sapphire/Emerald/Topaz).
// Gated by box VARIANT id so it never affects any other product.
const COLOR_CONSISTENCY_BOX_VARIANT_IDS = new Set<string>([
  "10f893b9-4425-51f8-8c8e-4a8546892109", // SAS KS GRADE 1 MAGIC BOX BOYS
]);

/** The colour axis within an item's attribute groups, if any. */
function colorAxisOf(groups: { name: string; values: string[] }[]) {
  return groups.find((g) => /colou?r/i.test(g.name)) ?? null;
}

/** Canonical colour token for cross-item comparison: the parenthetical
 *  real colour ("Ruby Spartans - (Red)" → "red"), else the whole value. */
function canonicalColor(value: string): string {
  const m = value.match(/\(([^)]+)\)/);
  return (m ? m[1] : value).trim().toLowerCase();
}

type Variant = {
  id: string;
  size: string;
  sku: string;
  pricePaise: number | null;
  mrpPaise: number | null;
  available: number;
};

type SizeTableRow = { size: string; chest: string; length: string; sleeve: string };

type ItemState = {
  node: BundleNode;
  variants: Variant[];
  loading: boolean;
  pickedVariantId: string | null;
  /** Multi-axis Item-Variant data when the sub-item is e.g. a bookkit with
   *  Mandate × Core × Elective. Empty for plain size/colour sub-items. */
  attributeGroups: { name: string; values: string[] }[];
  variantsByAttributeKey: Record<string, string>;
  /** Own primary image, or a sibling-kit fallback for un-photographed kits.
   *  null for non-kit items without their own photo (renderer falls back
   *  to a Package icon). */
  imageUrl: string | null;
  /** Per-item size guide opened from the row. */
  sizeTable: SizeTableRow[] | null;
  sizeChartUrl: string | null;
  /** Selection to seed MultiAttributePicker with when restoring from a
   *  saved draft or an existing cart line. Stays stable across user picks
   *  (those flow through pickedVariantId) so the picker isn't unnecessarily
   *  remounted; the `key` prop on the picker is tied to this object so it
   *  remounts exactly when restoration arrives. */
  restoredSelection: Record<string, string> | null;
};

/**
 * Magic Box configurator — every component item in the box must have a
 * variant/size chosen before the box can be added to the cart.
 *
 * Handles two special cases beyond plain size buttons:
 *  - Bookkit language variants: renders a structured 2nd/3rd language picker.
 *  - Already-in-cart: pre-fills saved sizes and shows an "in cart" banner.
 */
export function MagicBoxConfigurator({
  nodes,
  boxPrice,
  boxVariantId,
  initialPicks,
  onPicksChange,
  onAddSuccess,
}: {
  nodes: BundleNode[];
  boxPrice: number;
  boxVariantId: string;
  /** Restore from a saved draft. Maps componentProductId → variantId.
   *  Unknown component IDs or missing variants are silently ignored. */
  initialPicks?: Record<string, string | null>;
  /** Fires on each pick. Used by the PDP draft-saver. */
  onPicksChange?: (picks: Record<string, string | null>) => void;
  /** Fires after a successful Add-to-Cart. PDP uses this to clear the
   *  draft so re-visits don't restore an already-committed selection. */
  onAddSuccess?: () => void;
}) {
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId") ?? "";
  const { lines, refresh } = useCart();

  const [items, setItems] = useState<ItemState[]>(
    nodes.map((n) => ({
      node: n,
      variants: [],
      loading: true,
      pickedVariantId: null,
      attributeGroups: [],
      variantsByAttributeKey: {},
      imageUrl: null,
      sizeTable: null,
      sizeChartUrl: null,
      restoredSelection: null,
    }))
  );
  // Per-item size-guide modal target. null = closed.
  const [sizeGuideFor, setSizeGuideFor] = useState<ItemState | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [err, setErr] = useState<string>();
  const [showErrors, setShowErrors] = useState(false);
  const [prefilledFromCart, setPrefilledFromCart] = useState(false);
  // True when seedItems() applied at least one pick from the saved draft
  // (i.e. the parent has been here before, hit a different page, and is
  // now back). Surfaces a banner so they trust auto-save.
  const [prefilledFromDraft, setPrefilledFromDraft] = useState(false);
  const prefilledRef = useRef(false);

  // House-colour consistency — only for the gated box(es). `settledRef`
  // suppresses the warning during the initial load + restore wave (the
  // MultiAttributePicker fires onResolve on mount, which routes through
  // pick()); it flips true a tick after loading finishes, so only genuine
  // user picks warn. `refColorRef` holds the FIRST house colour the parent
  // chose (the reference every later pick is compared against).
  const colorCheckEnabled = COLOR_CONSISTENCY_BOX_VARIANT_IDS.has(boxVariantId);
  const settledRef = useRef(false);
  const refColorRef = useRef<{
    canon: string;
    raw: string;
    itemKey: string;
  } | null>(null);
  const [colorWarn, setColorWarn] = useState<
    | { mode: "pick"; changedIdx: number; newRaw: string; refRaw: string; refItems: string[] }
    | { mode: "final"; breakdown: { raw: string; count: number }[] }
    | null
  >(null);

  // Load variants for each bundle item.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      nodes.map((n) => {
        const sp = new URLSearchParams({ productId: n.productId });
        if (studentId) sp.set("studentId", studentId);
        return fetch(`/api/shop/bundle-item?${sp.toString()}`, { cache: "no-store" })
          .then((r) => r.json())
          .then(
            (d: {
              variants?: Variant[];
              attributeGroups?: { name: string; values: string[] }[];
              variantsByAttributeKey?: Record<string, string>;
              imageUrl?: string | null;
              sizeTable?: SizeTableRow[] | null;
              sizeChartUrl?: string | null;
            }) => ({
              variants: d.variants ?? [],
              attributeGroups: d.attributeGroups ?? [],
              variantsByAttributeKey: d.variantsByAttributeKey ?? {},
              imageUrl: d.imageUrl ?? null,
              sizeTable: d.sizeTable ?? null,
              sizeChartUrl: d.sizeChartUrl ?? null,
            })
          )
          .catch(() => ({
            variants: [] as Variant[],
            attributeGroups: [] as { name: string; values: string[] }[],
            variantsByAttributeKey: {} as Record<string, string>,
            imageUrl: null as string | null,
            sizeTable: null as SizeTableRow[] | null,
            sizeChartUrl: null as string | null,
          }));
      })
    ).then((all) => {
      if (cancelled) return;

      let restoredFromDraft = false;
      const newItems: ItemState[] = nodes.map((n, i) => {
        // Seed pick order: single-value axis auto-pick → draft restore →
        // null. Drafts only apply when the saved variant is still reachable.
        // "Reachable" has two cases:
        //   - single-axis: the variant id appears directly in `variants`
        //     (the collapsed-by-size list the size-buttons render from).
        //   - multi-axis: the variant id appears as a *value* in
        //     `variantsByAttributeKey` (the full colour×size map). The
        //     collapsed `variants` array can't be used here — it keeps only
        //     one representative per size label, so the actual picked
        //     (colour, size) variantId isn't necessarily in it.
        let pickedVariantId: string | null =
          all[i].variants.length === 1 ? all[i].variants[0].id : null;
        const draftVid = initialPicks?.[n.productId] ?? null;
        if (draftVid) {
          if (all[i].variants.some((v) => v.id === draftVid)) {
            pickedVariantId = draftVid;
            restoredFromDraft = true;
          } else if (
            Object.values(all[i].variantsByAttributeKey).includes(draftVid)
          ) {
            pickedVariantId = draftVid;
            restoredFromDraft = true;
          }
        }
        // Multi-axis components need a per-axis selection to pre-highlight
        // the right buttons on the MultiAttributePicker — pickedVariantId
        // alone isn't enough since the picker keys its internal state by
        // (axis name → value), not by variantId.
        const restoredSelection =
          pickedVariantId &&
          Object.keys(all[i].variantsByAttributeKey).length > 0
            ? selectionFromVariantId(all[i].variantsByAttributeKey, pickedVariantId)
            : null;
        return {
          node: n,
          variants: all[i].variants,
          loading: false,
          pickedVariantId,
          attributeGroups: all[i].attributeGroups,
          variantsByAttributeKey: all[i].variantsByAttributeKey,
          imageUrl: all[i].imageUrl,
          sizeTable: all[i].sizeTable,
          sizeChartUrl: all[i].sizeChartUrl,
          restoredSelection,
        };
      });

      setItems(newItems);
      if (restoredFromDraft) setPrefilledFromDraft(true);
    });
    return () => {
      cancelled = true;
    };
  }, [nodes, studentId, boxVariantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill saved sizes from cart once both variants AND cart lines are loaded.
  // Runs whenever lines change (cart loads async, often after variants finish).
  useEffect(() => {
    if (prefilledRef.current) return;
    const allLoaded = items.length > 0 && items.every((it) => !it.loading);
    if (!allLoaded) return;
    const existing = lines.find((l) => l.variantId === boxVariantId);
    if (!existing?.bundleSelections?.length) return;

    prefilledRef.current = true;
    setItems((cur) =>
      cur.map((it) => {
        const saved = existing.bundleSelections!.find(
          (s) => s.componentProductId === it.node.productId
        );
        if (!saved) return it;
        // Resolve which variantId to restore:
        //  1. direct hit in the collapsed-by-size `variants` array
        //     (single-axis components like Bloomers, Caps).
        //  2. multi-axis hit — saved.variantId is one of the values in
        //     `variantsByAttributeKey` even though `variants` doesn't
        //     contain it (Sports Polo / Sports Track style — colour ×
        //     size collapses to one representative per size).
        //  3. legacy size-string match for rows persisted before
        //     bundleSelections.variantId was reliably populated.
        let matchedVariantId: string | null = null;
        const direct = it.variants.find((v) => v.id === saved.variantId);
        if (direct) {
          matchedVariantId = direct.id;
        } else if (
          saved.variantId &&
          Object.values(it.variantsByAttributeKey).includes(saved.variantId)
        ) {
          matchedVariantId = saved.variantId;
        } else {
          const sized = it.variants.find((v) => v.size === saved.size);
          if (sized) matchedVariantId = sized.id;
        }
        if (!matchedVariantId) return it;
        // Mirror the draft-restore branch above: derive the per-axis
        // selection so the MultiAttributePicker can pre-highlight the
        // right buttons on remount.
        const restoredSelection =
          Object.keys(it.variantsByAttributeKey).length > 0
            ? selectionFromVariantId(it.variantsByAttributeKey, matchedVariantId)
            : null;
        return {
          ...it,
          pickedVariantId: matchedVariantId,
          restoredSelection: restoredSelection ?? it.restoredSelection,
        };
      })
    );
    setPrefilledFromCart(true);
    setAdded(true);
  }, [lines, items, boxVariantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stillLoading = items.some((it) => it.loading);
  const choosable = items.filter((it) => it.variants.length > 0);
  const pickedCount = choosable.filter((it) => it.pickedVariantId).length;
  const allPicked = !stillLoading && pickedCount === choosable.length;

  // Arm the colour check only after loading settles, so the picker's
  // mount-time onResolve (restore wave) can establish the reference
  // silently without popping the warning.
  useEffect(() => {
    if (!colorCheckEnabled || stillLoading) return;
    const t = setTimeout(() => {
      settledRef.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, [colorCheckEnabled, stillLoading]);

  /** The chosen house colour for an item, or null when the item has no
   *  genuine colour choice (no colour axis, or a single forced colour) or
   *  isn't fully picked yet. */
  function itemColor(it: ItemState): { raw: string; canon: string } | null {
    if (!it.pickedVariantId) return null;
    const axis = colorAxisOf(it.attributeGroups);
    if (!axis || axis.values.length < 2) return null;
    const sel = selectionFromVariantId(it.variantsByAttributeKey, it.pickedVariantId);
    const raw = sel?.[axis.name];
    return raw ? { raw, canon: canonicalColor(raw) } : null;
  }

  /** Distinct house colours currently across the box's colour-items. */
  function colorBreakdown(): Map<string, { raw: string; names: string[] }> {
    const m = new Map<string, { raw: string; names: string[] }>();
    for (const it of items) {
      const c = itemColor(it);
      if (!c) continue;
      const e = m.get(c.canon) ?? { raw: c.raw, names: [] };
      e.names.push(it.node.name);
      m.set(c.canon, e);
    }
    return m;
  }

  // After a genuine user pick, maintain the reference colour and warn on
  // divergence. Reads the just-picked colour from `variantId` directly
  // (state is async) and every other item from the current `items`.
  function maybeWarnOnPick(idx: number, variantId: string | null) {
    const it = items[idx];
    const axis = colorAxisOf(it.attributeGroups);
    if (!axis || axis.values.length < 2) return; // not a colour item
    const newColor = variantId
      ? (() => {
          const sel = selectionFromVariantId(it.variantsByAttributeKey, variantId);
          const raw = sel?.[axis.name];
          return raw ? { raw, canon: canonicalColor(raw) } : null;
        })()
      : null;
    const key = it.node.componentId;

    if (!newColor) {
      if (refColorRef.current?.itemKey === key) refColorRef.current = null;
      return;
    }
    const ref = refColorRef.current;
    if (!ref) {
      refColorRef.current = { ...newColor, itemKey: key };
      return;
    }
    if (ref.itemKey === key) {
      // The reference item changed its OWN colour — it stays the reference.
      refColorRef.current = { ...newColor, itemKey: key };
      return;
    }
    if (newColor.canon !== ref.canon) {
      if (!settledRef.current) return; // suppress during restore wave
      const refItems = items
        .map((other, i) => (i === idx ? null : other))
        .filter((o): o is ItemState => o !== null)
        .filter((o) => itemColor(o)?.canon === ref.canon)
        .map((o) => o.node.name);
      setColorWarn({ mode: "pick", changedIdx: idx, newRaw: newColor.raw, refRaw: ref.raw, refItems });
    }
  }

  /** Modal action: switch this item to the reference colour, keeping its
   *  current size when that colour+size combo exists. Updates
   *  restoredSelection so the MultiAttributePicker remounts and reflects
   *  the change. */
  function applyReferenceColor(idx: number) {
    const it = items[idx];
    const axis = colorAxisOf(it.attributeGroups);
    const ref = refColorRef.current;
    setColorWarn(null);
    if (!axis || !ref) return;
    const curSel = it.pickedVariantId
      ? selectionFromVariantId(it.variantsByAttributeKey, it.pickedVariantId)
      : null;
    let targetVid: string | null = null;
    let targetSel: Record<string, string> | null = null;
    for (const [k, vid] of Object.entries(it.variantsByAttributeKey)) {
      let pairs: [string, string][];
      try {
        pairs = JSON.parse(k) as [string, string][];
      } catch {
        continue;
      }
      const tuple = Object.fromEntries(pairs);
      if (canonicalColor(tuple[axis.name] ?? "") !== ref.canon) continue;
      let ok = true;
      if (curSel) {
        for (const [a, v] of Object.entries(curSel)) {
          if (a === axis.name) continue;
          if (tuple[a] !== v) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        targetVid = vid;
        targetSel = tuple;
        break;
      }
    }
    prefilledRef.current = false;
    setItems((cur) => {
      const next = cur.map((c, i) =>
        i === idx
          ? { ...c, pickedVariantId: targetVid, restoredSelection: targetSel }
          : c
      );
      if (onPicksChange) {
        const picks: Record<string, string | null> = {};
        for (const c of next) picks[c.node.productId] = c.pickedVariantId;
        onPicksChange(picks);
      }
      return next;
    });
  }

  function pick(idx: number, variantId: string | null) {
    prefilledRef.current = false;
    setItems((cur) => {
      const next = cur.map((it, i) =>
        i === idx ? { ...it, pickedVariantId: variantId } : it
      );
      if (onPicksChange) {
        const picks: Record<string, string | null> = {};
        for (const it of next) picks[it.node.productId] = it.pickedVariantId;
        onPicksChange(picks);
      }
      return next;
    });
    setErr(undefined);
    setAdded(false);
    setPrefilledFromCart(false);
    if (colorCheckEnabled) maybeWarnOnPick(idx, variantId);
  }

  async function addAll() {
    if (!allPicked) {
      const missing = choosable
        .filter((it) => !it.pickedVariantId)
        .map((it) => it.node.name);
      setErr(`Please select a size for: ${missing.join(", ")}.`);
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (!boxVariantId) {
      setErr("This Magic Box can't be added right now.");
      return;
    }
    // Final safety net: if the box still mixes house colours, confirm once
    // before committing (covers per-pick warnings that were dismissed).
    if (colorCheckEnabled) {
      const bd = colorBreakdown();
      if (bd.size > 1) {
        setColorWarn({
          mode: "final",
          breakdown: Array.from(bd.values()).map((v) => ({
            raw: v.raw,
            count: v.names.length,
          })),
        });
        return;
      }
    }
    await doAddAll();
  }

  async function doAddAll() {
    setColorWarn(null);
    setAdding(true);
    setErr(undefined);
    try {
      const selections = items.flatMap((it) => {
        if (!it.pickedVariantId) return [];
        const v = it.variants.find((x) => x.id === it.pickedVariantId);
        return [
          {
            componentProductId: it.node.productId,
            name: it.node.name,
            qty: it.node.qty > 0 ? it.node.qty : 1,
            variantId: it.pickedVariantId,
            size: v?.size ?? "",
          },
        ];
      });
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId: boxVariantId,
          qty: 1,
          studentId: studentId || undefined,
          bundleSelections: selections,
        }),
      });
      if (!res.ok) throw new Error();
      await refresh();
      setAdded(true);
      setPrefilledFromCart(false);
      onAddSuccess?.();
    } catch {
      setErr("Something went wrong adding the box to your cart.");
    } finally {
      setAdding(false);
    }
  }

  const alreadyInCart = prefilledFromCart || (added && !adding);

  return (
    <div>
      {/* Already-in-cart banner */}
      {prefilledFromCart && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2.5">
          <ShoppingCart className="h-4 w-4 text-emerald-600 shrink-0" />
          <p className="text-[13px] font-semibold text-emerald-700">
            This Magic Box is already in your cart — your saved sizes are pre-filled below.
          </p>
        </div>
      )}

      {/* Draft-restored banner. Distinct from the cart banner above: this
          fires when the parent had partially configured the box, navigated
          away, and came back. The picks were never added to cart but were
          auto-saved (localStorage + /api/shop/draft) — see useProductDraft.
          Mutually exclusive with the cart banner so we don't double-up. */}
      {!prefilledFromCart && prefilledFromDraft && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 flex items-center gap-2.5">
          <Check className="h-4 w-4 text-brand-700 shrink-0" />
          <p className="text-[13px] font-semibold text-brand-800">
            Your earlier picks were restored — keep going or change them below.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-ink-100 bg-white divide-y divide-ink-100">
        {items.map((it, idx) => {
          const needsChoice = it.variants.length > 0 && !it.pickedVariantId;
          const highlightMissing = showErrors && needsChoice;
          const langPairs = parseBookkitLangs(it.variants);

          return (
            <div
              key={it.node.componentId}
              className={`p-4 transition-colors ${highlightMissing ? "bg-red-50" : ""}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={
                    "grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold shrink-0 " +
                    (it.variants.length === 0 || it.pickedVariantId
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700")
                  }
                >
                  {it.variants.length === 0 || it.pickedVariantId ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    idx + 1
                  )}
                </span>
                {/* Thumbnail. Real photo when present; generic Package
                    icon otherwise. Sized so a parent can actually read
                    the product they're configuring. */}
                <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-xl border border-ink-100 bg-cream-50 grid place-items-center overflow-hidden shrink-0">
                  {it.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={it.imageUrl}
                      alt={it.node.name}
                      className="h-full w-full object-contain p-2"
                    />
                  ) : (
                    <Package className="h-8 w-8 text-ink-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-ink-900 leading-tight">
                    {it.node.name}
                    {it.node.qty > 1 && (
                      <span className="ml-1.5 text-[12px] font-normal text-ink-500">
                        × {it.node.qty}
                      </span>
                    )}
                  </p>
                  {/* Show the chip only when there's actual chart data to
                      display. Bookkits / sub-bundles / magic-box containers
                      and accessory items (socks, belts, caps, ties, shoes)
                      never have a chart in the DB, so the button vanishes
                      for those — matching the user's "not a uniform" cut. */}
                  {(it.sizeTable?.length || it.sizeChartUrl) && (
                    <button
                      type="button"
                      onClick={() => setSizeGuideFor(it)}
                      className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[12px] font-semibold text-brand-700 hover:bg-brand hover:text-white transition-colors"
                    >
                      <Ruler className="h-3.5 w-3.5" /> Size guide
                    </button>
                  )}
                </div>
              </div>

              {it.loading ? (
                <p className="mt-2 ml-7 text-[12px] text-ink-400 flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </p>
              ) : it.variants.length === 0 ? (
                <p className="mt-1 ml-7 text-[12px] text-ink-500">
                  Included — no size to choose.
                </p>
              ) : it.attributeGroups.length >= 2 &&
                Object.keys(it.variantsByAttributeKey).length > 1 ? (
                // Multi-axis bookkit nested inside the Magic Box — render
                // the same picker the standalone PDP uses, scoped to this
                // sub-item.
                <div className="mt-1 ml-7">
                  <MultiAttributePicker
                    // Remount only when a restored selection arrives so the
                    // picker honours it on its (single-shot) mount-time seed
                    // pass. Stable across user picks — those update
                    // pickedVariantId only, not restoredSelection.
                    key={
                      it.restoredSelection
                        ? `restored:${JSON.stringify(it.restoredSelection)}`
                        : `fresh:${idx}`
                    }
                    groups={it.attributeGroups}
                    variantsByAttributeKey={it.variantsByAttributeKey}
                    initialSelection={it.restoredSelection ?? undefined}
                    onResolve={(vid) => pick(idx, vid)}
                  />
                  {needsChoice && (
                    <p className="mt-2 text-[11px] font-medium text-amber-600">
                      Pick every option above to complete this item
                    </p>
                  )}
                </div>
              ) : langPairs ? (
                <LanguagePicker
                  pairs={langPairs}
                  pickedVariantId={it.pickedVariantId}
                  onPick={(id) => pick(idx, id)}
                  needsChoice={needsChoice}
                />
              ) : (
                <div className="mt-2 ml-7 flex flex-wrap gap-2">
                  {it.variants.map((v) => {
                    const active = it.pickedVariantId === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => pick(idx, v.id)}
                        className={
                          "rounded-lg border px-3 py-1.5 text-[13px] transition " +
                          (active
                            ? "border-brand bg-brand text-white font-bold shadow-sm"
                            : "border-ink-200 text-ink-700 font-medium hover:border-ink-400")
                        }
                      >
                        {v.size}
                      </button>
                    );
                  })}
                  {needsChoice && (
                    <span className="self-center text-[11px] font-medium text-amber-600">
                      Select a size
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Configured-bundle review — shows the exact set of items + chosen
          sizes a parent is about to add, so they can sanity-check before
          committing. Hidden until at least one size is picked. */}
      {!stillLoading && pickedCount > 0 && (
        <div className="mt-4 rounded-2xl border border-ink-100 bg-cream-50/60 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-500">
            Review your box
          </p>
          <ul className="mt-2 grid sm:grid-cols-2 gap-x-5 gap-y-2">
            {items.map((it) => {
              const included = it.variants.length === 0;
              const isMultiAxis = it.attributeGroups.length >= 2;
              // For multi-axis components the configurator's `it.variants`
              // array is collapsed-by-size (one representative per size
              // label), so `pickedVariantId` is often NOT present there —
              // the picker resolves through `variantsByAttributeKey` which
              // keeps every colour×size combo. Use that map as a fallback
              // so we don't falsely render "Pick a size" on a row whose
              // pick is fully captured but lives only in the multi-axis map.
              const pickedIsKnown =
                !!it.pickedVariantId &&
                (it.variants.some((v) => v.id === it.pickedVariantId) ||
                  Object.values(it.variantsByAttributeKey).includes(it.pickedVariantId));
              const pickedSize = it.pickedVariantId
                ? it.variants.find((v) => v.id === it.pickedVariantId)?.size ?? null
                : null;
              return (
                <li
                  key={it.node.componentId}
                  className="grid grid-cols-[1fr_auto] gap-x-3 items-baseline text-[13px]"
                >
                  <span className="text-ink-800 leading-snug">
                    {it.node.name}
                    {it.node.qty > 1 && (
                      <span className="ml-1 text-ink-500">×{it.node.qty}</span>
                    )}
                  </span>
                  {included ? (
                    <span className="text-[11px] font-medium text-ink-500 text-right">
                      Included
                    </span>
                  ) : pickedIsKnown && (isMultiAxis || !pickedSize) ? (
                    // Multi-axis variants would otherwise show the full
                    // concatenated SKU string here. Just confirm the slot
                    // is configured — the parent has already picked their
                    // axes in the row above.
                    <span className="text-[11px] font-semibold text-emerald-700 text-right">
                      Configured
                    </span>
                  ) : pickedIsKnown && pickedSize ? (
                    <span className="font-mono text-[11px] font-bold text-ink-900 text-right">
                      {pickedSize}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-amber-600 text-right">
                      Pick a size
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="text-[14px] text-ink-600">
          {stillLoading ? (
            "Loading box contents…"
          ) : (
            <>
              <span className="font-semibold text-ink-900">
                {pickedCount}/{choosable.length}
              </span>{" "}
              items sized
              <span className="ml-3 text-ink-900 font-bold">
                Magic Box price ₹{boxPrice.toLocaleString("en-IN")}
              </span>
              {/* Auto-save reassurance: shown the moment the parent has
                  made any pick, until the box is in the cart. The persistence
                  layer (useProductDraft) already writes to localStorage on
                  every change and debounces to the server at 400 ms, so
                  navigating away and back returns to the same picks. */}
              {pickedCount > 0 && !alreadyInCart && (
                <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <Check className="h-3 w-3" /> Auto-saved
                </span>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          disabled={!allPicked || adding}
          onClick={addAll}
          className="sm:ml-auto inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? (
            "Saving…"
          ) : alreadyInCart && !prefilledFromCart ? (
            <>
              <Check className="h-4 w-4" /> Added to cart
            </>
          ) : alreadyInCart && prefilledFromCart ? (
            <>
              <ShoppingBag className="h-4 w-4" /> Update cart
            </>
          ) : (
            <>
              <ShoppingBag className="h-4 w-4" /> Add Magic Box to cart
            </>
          )}
        </button>
      </div>

      {err && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-[13px] font-semibold text-red-700">{err}</p>
        </div>
      )}

      {/* Per-item size-guide modal. Closed when sizeGuideFor === null. */}
      {sizeGuideFor && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center px-4"
          onClick={() => setSizeGuideFor(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[85vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 p-5 border-b border-ink-100">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 border border-brand-100 text-brand">
                  <Ruler className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-display text-[16px] font-bold text-ink-900">
                    Size guide
                  </p>
                  <p className="text-[12px] text-ink-500">{sizeGuideFor.node.name} · in inches</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSizeGuideFor(null)}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-full text-ink-500 hover:bg-cream-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <SizeGuideTable
                sizeTable={sizeGuideFor.sizeTable}
                sizeChartUrl={sizeGuideFor.sizeChartUrl}
                productName={sizeGuideFor.node.name}
              />
            </div>
          </div>
        </div>
      )}

      {/* House-colour consistency warning (gated boxes only). Soft confirm —
          never blocks. `pick` mode fires on a diverging selection; `final`
          mode fires at Add-to-cart if the box still mixes colours. */}
      {colorWarn && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center px-4"
          onClick={() => setColorWarn(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 p-5 border-b border-ink-100">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 border border-amber-100 text-amber-600 shrink-0">
                <AlertCircle className="h-4 w-4" />
              </span>
              <div>
                <p className="font-display text-[16px] font-bold text-ink-900">
                  {colorWarn.mode === "final"
                    ? "This box has mixed colours"
                    : "Different house colour?"}
                </p>
                <p className="text-[12px] text-ink-500">
                  Uniform sets are usually all one house colour.
                </p>
              </div>
            </div>
            <div className="p-5 text-[13.5px] text-ink-700 leading-relaxed">
              {colorWarn.mode === "pick" ? (
                <>
                  {colorWarn.refItems.length > 1 ? (
                    <>
                      <p>
                        You&apos;ve chosen{" "}
                        <b className="text-ink-900">{colorWarn.refRaw}</b> for
                        these items:
                      </p>
                      <ul className="mt-1.5 ml-1 list-disc list-inside text-ink-600">
                        {colorWarn.refItems.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>
                      You&apos;ve chosen{" "}
                      <b className="text-ink-900">{colorWarn.refRaw}</b>
                      {colorWarn.refItems[0] ? (
                        <>
                          {" "}
                          for{" "}
                          <b className="text-ink-900">{colorWarn.refItems[0]}</b>
                        </>
                      ) : null}
                      .
                    </p>
                  )}
                  <p className="mt-3">
                    For{" "}
                    <b className="text-ink-900">
                      {items[colorWarn.changedIdx]?.node.name}
                    </b>{" "}
                    you&apos;ve now picked{" "}
                    <b className="text-ink-900">{colorWarn.newRaw}</b>. Are you
                    sure you want to continue with a different colour?
                  </p>
                </>
              ) : (
                <>
                  <p>This box mixes house colours:</p>
                  <ul className="mt-1.5 ml-1 list-disc list-inside text-ink-600">
                    {colorWarn.breakdown.map((b) => (
                      <li key={b.raw}>
                        <b className="text-ink-900">{b.raw}</b> — {b.count} item
                        {b.count > 1 ? "s" : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3">Add the box to your cart anyway?</p>
                </>
              )}
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-5 pt-0">
              {colorWarn.mode === "pick" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setColorWarn(null)}
                    className="rounded-full border border-ink-200 px-4 py-2.5 text-[13px] font-semibold text-ink-700 hover:border-ink-400"
                  >
                    Keep {colorWarn.newRaw}
                  </button>
                  <button
                    type="button"
                    onClick={() => applyReferenceColor(colorWarn.changedIdx)}
                    className="rounded-full bg-brand text-white px-4 py-2.5 text-[13px] font-bold hover:bg-brand-600"
                  >
                    Use {colorWarn.refRaw} here
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setColorWarn(null)}
                    className="rounded-full border border-ink-200 px-4 py-2.5 text-[13px] font-semibold text-ink-700 hover:border-ink-400"
                  >
                    Go back
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void doAddAll();
                    }}
                    className="rounded-full bg-brand text-white px-4 py-2.5 text-[13px] font-bold hover:bg-brand-600"
                  >
                    Add anyway
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LanguagePicker({
  pairs,
  pickedVariantId,
  onPick,
  needsChoice,
}: {
  pairs: LangPair[];
  pickedVariantId: string | null;
  onPick: (variantId: string) => void;
  needsChoice: boolean;
}) {
  const picked = pairs.find((p) => p.variantId === pickedVariantId) ?? null;
  const secondLangs = [...new Set(pairs.map((p) => p.secondLang))].sort();

  return (
    <div className="mt-2 ml-7 space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500 mb-2">
          2nd Language
        </p>
        <div className="flex flex-wrap gap-2">
          {secondLangs.map((lang) => {
            const match = pairs.find((p) => p.secondLang === lang)!;
            const active = picked?.secondLang === lang;
            return (
              <button
                key={lang}
                type="button"
                onClick={() => onPick(match.variantId)}
                className={
                  "rounded-lg border px-3 py-1.5 text-[13px] transition " +
                  (active
                    ? "border-brand bg-brand text-white font-bold shadow-sm"
                    : "border-ink-200 text-ink-700 font-medium hover:border-ink-400")
                }
              >
                {lang}
              </button>
            );
          })}
          {needsChoice && !picked && (
            <span className="self-center text-[11px] font-medium text-amber-600">
              Select 2nd language
            </span>
          )}
        </div>
      </div>

      {picked && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500 mb-2">
            3rd Language
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="rounded-lg border border-brand bg-brand/10 text-brand-700 font-bold px-3 py-1.5 text-[13px]">
              {picked.thirdLang}
            </span>
            <span className="text-[11px] text-ink-400">auto-selected</span>
          </div>
        </div>
      )}
    </div>
  );
}
