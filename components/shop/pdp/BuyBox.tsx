"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Heart, ShoppingBag, Check, Star, Truck, Shield, Award, Ruler, X } from "lucide-react";
import { Product } from "@/lib/products";
import { useCart } from "@/lib/cart";
import { QtyStepper } from "./QtyStepper";
import { parseBookkitLangs, type LangPair } from "@/lib/bookkit-langs";
import { MultiAttributePicker } from "./MultiAttributePicker";
import { buildAttributeKey } from "@/lib/attribute-key";
import { dedupeAttributeGroups } from "@/lib/normalize-attribute-name";
import { usePdpSelection } from "./SelectionContext";

const trust = [
  { icon: Award, label: "Branded for your school" },
  { icon: Truck, label: "Try before you buy" },
  { icon: Shield, label: "Quality-tested" },
];

/**
 * Some categories don't need a size chart even when admin set one in the
 * database — bookkits, caps, shoes, bags, ties, belts. The check is
 * name/category-based (not just `kind`) because some bookkits are
 * mis-classified as `uniform` in admin and `kind` alone misses them.
 */
const NO_SIZE_CHART_RE =
  /\b(book[\s-]?kit|book[\s-]?set|bookset|bookkit|cap|caps|shoe|shoes|bag|bags|tie|ties|belt|belts)\b/i;
function isNoSizeChartCategory(product: Product): boolean {
  if (product.kind === "kit" || product.kind === "set") return true;
  if (NO_SIZE_CHART_RE.test(product.name)) return true;
  if (product.categoryPath?.some((seg) => NO_SIZE_CHART_RE.test(seg)))
    return true;
  return false;
}

export function BuyBox({
  product,
  onSizeGuide,
}: {
  product: Product;
  onSizeGuide: () => void;
}) {
  const { add, addByVariantId } = useCart();
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentQuery = searchParams?.get("studentId")
    ? `?studentId=${encodeURIComponent(searchParams.get("studentId") as string)}`
    : "";

  // Template-level variants (language / stream pickers). When present,
  // a click navigates to that variant's own PDP — each variant has its
  // own price + size SKUs.
  const tplVariants = product.templateVariants ?? [];
  const hasTplVariants = tplVariants.length > 0;

  // Defensive read-time dedupe of attribute_groups. The primary fix lives
  // at the write site (re-derivation in product PATCH +
  // refreshProductAttributeGroups) but for products whose JSON was written
  // before the fix shipped, or by any path that bypasses the re-derivation,
  // we collapse same-named axes here so the picker only renders once.
  // `dedupeAttributeGroups` is a no-op when the data is already clean.
  const effectiveAttributeGroups = useMemo(
    () => dedupeAttributeGroups(product.attributeGroups ?? []),
    [product.attributeGroups],
  );

  // Multi-axis Item-Variant template (e.g. SMS Grade 11 Bookkit with
  // Mandate × Core × Elective). Activates for kits AND for any product
  // whose `sizes` array carries concatenated SKU strings (e.g.
  // "SAS Suchitra Book Set Grade 12Grade 12 MandateCommerceApplied
  // Mathematics") — those products are bookkits mis-classified as
  // `uniform` in admin and the legacy size picker would otherwise show
  // the garbled SKUs as size pills.
  const multiAxisGroups = effectiveAttributeGroups;
  const variantMap = product.variantsByAttributeKey ?? {};
  const productNameLower = product.name.toLowerCase();
  const sizesLookLikeSkus = (product.sizes ?? []).some((s) => {
    if (!s) return false;
    if (s.length > 22) return true;
    if (
      productNameLower &&
      s.toLowerCase().startsWith(productNameLower.slice(0, 12))
    )
      return true;
    // After the 2026-05-26 duplicate-size dedup pass, multi-axis uniforms
    // (T-shirts, bags, sports kit) carry their full ERPNext SKU as the
    // size value so variantPrices/variantIds key uniquely. These SKUs use
    // the "$$" marker as a terminator (e.g. "SAMYU PP BAGSBM$$$",
    // "SAS KS Sports T-shirt34$$A"), so detecting the marker is enough
    // to flip MultiAttributePicker on for shorter SKU strings that don't
    // hit the 22-char threshold.
    if (s.includes("$$")) return true;
    return false;
  });
  const useMultiAxisPicker =
    !hasTplVariants &&
    multiAxisGroups.length >= 2 &&
    Object.keys(variantMap).length > 1 &&
    (product.kind === "kit" || product.isKit === true || sizesLookLikeSkus);
  const [resolvedVariantId, setResolvedVariantId] = useState<string | null>(null);

  // default to a middle size if many options, else the first.
  // Falls back to "" when no sizes exist (admin retired all variants);
  // the Add button is disabled below when this is empty so we never
  // call `add()` with an undefined size.
  const [size, setSize] = useState<string>(
    product.sizes.length > 6
      ? product.sizes[Math.floor(product.sizes.length / 2)] ?? ""
      : product.sizes[0] ?? ""
  );
  // If a focus-refetch (the PDP re-fetches the product on window focus) changes
  // the available variants and drops the currently-selected size, fall back to
  // a sensible default so the chosen size can't silently desync from the size
  // pills shown — the root of "parent picked 40, cart stored 28". Product →
  // product SPA navigation is handled by the `key={product.id}` remount at the
  // call site, which resets every selection to the new product's defaults.
  useEffect(() => {
    if (size && product.sizes.length > 0 && !product.sizes.includes(size)) {
      setSize(
        product.sizes.length > 6
          ? product.sizes[Math.floor(product.sizes.length / 2)] ?? ""
          : product.sizes[0] ?? ""
      );
    }
  }, [product.sizes, size]);
  // Non-size attribute selections (Colour, House, etc.). Default each axis
  // to its first value so a parent who never clicks still has a valid pick.
  // Lifted out of AttributeGroupPicker because the picker's earlier
  // component-local state was never read by add-to-cart — that bug shipped
  // the wrong colour variant for every uniform with a colour axis.
  const nonSizeAttrGroups = useMemo(
    () => effectiveAttributeGroups.filter((g) => !/size|sizes/i.test(g.name)),
    [effectiveAttributeGroups]
  );
  const [attrSel, setAttrSel] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of nonSizeAttrGroups) {
      if (g.values[0]) init[g.name] = g.values[0];
    }
    return init;
  });
  // Mirror the attribute selection into the PDP-level context (when a
  // provider exists) so the Gallery can surface the selected colour's
  // images. Includes the initial default so the gallery matches the
  // pre-selected colour on first paint.
  const pdpSelection = usePdpSelection();
  const publishAttrSel = pdpSelection?.setAttrSel;
  useEffect(() => {
    publishAttrSel?.(attrSel);
  }, [attrSel, publishAttrSel]);
  const [qty, setQty] = useState(1);
  const [liked, setLiked] = useState(false);
  const [added, setAdded] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Inline size-chart enlarge state. Click the compact card below the
  // price to open a centred modal with the full chart.
  const [chartOpen, setChartOpen] = useState(false);
  // Portal target gate — `document` doesn't exist on the SSR pass, so we
  // flip this to true after first client paint to enable createPortal.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    setPortalReady(true);
  }, []);

  const noSizesAvailable = product.sizes.length === 0;
  const variantStock = size ? product.variantStocks?.[size] : undefined;
  // Refined below once the Colour × Size variant is resolved; the size-keyed
  // map collapses colours sharing a size, so it is only the fallback.
  const sizeKeyedOutOfStock = variantStock !== undefined && variantStock <= 0;
  // Stock is synced from the audit's Ground Stock every 5 minutes
  // (2026-09-16), so a size with nothing counted cannot be added. For the
  // single-axis picker the size keys `variantStocks`; for the multi-axis
  // picker the resolved Colour × Size variant carries its own figure.
  const stockByVariantId = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of product.variants ?? []) m.set(v.id, v.stockQty);
    return m;
  }, [product.variants]);
  const resolvedVariantStock = resolvedVariantId
    ? stockByVariantId.get(resolvedVariantId)
    : undefined;
  const resolvedVariantOutOfStock =
    resolvedVariantStock !== undefined && resolvedVariantStock <= 0;

  // When the product has a non-size attribute (Colour, House, …), resolve
  // the variantId on the client using `variantsByAttributeKey`. The legacy
  // by-size-only lookup at /api/shop/variant returns the first row matching
  // the size and ignores colour, which is what produced the wrong-colour-
  // in-cart bug. Find the variant whose attributes match every current
  // selection across all axes (size + non-size).
  const sizeAxis = useMemo(
    () => effectiveAttributeGroups.find((g) => /size|sizes/i.test(g.name)) ?? null,
    [effectiveAttributeGroups]
  );
  const sizeAxisName = sizeAxis?.name ?? null;

  // Per-axis availability map. For each non-size axis value (e.g. Colour
  // = blue), the Set holds the sizes that actually exist as a variant. We
  // use this to disable size pills that don't exist for the currently
  // picked colour — a parent shopping for "blue" sees 20/22/24/26 active
  // and the others greyed out when blue only stocks those, etc.
  //
  // Built from `variantsByAttributeKey` so it stays in sync with whatever
  // the server resolved. Empty map → no filtering (legacy / single-axis
  // products keep their previous behaviour).
  const sizesByNonSizeAxisValue = useMemo(() => {
    const out = new Map<string, Set<string>>();
    if (!sizeAxisName || nonSizeAttrGroups.length === 0) return out;
    const map = product.variantsByAttributeKey ?? {};
    for (const key of Object.keys(map)) {
      let pairs: [string, string][];
      try {
        pairs = JSON.parse(key) as [string, string][];
      } catch {
        continue;
      }
      const obj = Object.fromEntries(pairs);
      const sz = obj[sizeAxisName];
      if (!sz) continue;
      for (const g of nonSizeAttrGroups) {
        const v = obj[g.name];
        if (!v) continue;
        const mk = `${g.name}|${v}`;
        let s = out.get(mk);
        if (!s) {
          s = new Set<string>();
          out.set(mk, s);
        }
        s.add(sz);
      }
    }
    return out;
  }, [sizeAxisName, nonSizeAttrGroups, product.variantsByAttributeKey]);

  // Set of sizes available for the *current* non-size selection. Null
  // means "no filter" — show all sizes as enabled. Computed as the
  // intersection across each non-size axis the customer has picked.
  const availableSizes = useMemo<Set<string> | null>(() => {
    if (nonSizeAttrGroups.length === 0 || sizesByNonSizeAxisValue.size === 0) {
      return null;
    }
    let acc: Set<string> | null = null;
    for (const g of nonSizeAttrGroups) {
      const sel = attrSel[g.name];
      if (!sel) continue;
      const s = sizesByNonSizeAxisValue.get(`${g.name}|${sel}`);
      if (!s) continue;
      if (acc === null) {
        acc = new Set<string>(s);
      } else {
        const next = new Set<string>();
        for (const x of acc) {
          if (s.has(x)) next.add(x);
        }
        acc = next;
      }
    }
    return acc;
  }, [nonSizeAttrGroups, attrSel, sizesByNonSizeAxisValue]);
  const resolvedAttrVariantId = useMemo<string | null>(() => {
    if (nonSizeAttrGroups.length === 0) return null;
    const map = product.variantsByAttributeKey ?? {};
    if (Object.keys(map).length === 0) return null;
    const sel: Record<string, string> = { ...attrSel };
    if (sizeAxisName && size && sizeAxis) {
      // size pills may be stored with a single-letter prefix (e.g. "V28")
      // but product_attribute_values.value carries the clean form. Resolve
      // against the axis's known values: exact match first (so "XL" stays
      // "XL"), then strip a single-char prefix only if the result is itself
      // a known value. An indiscriminate strip turned "XL" → "L" before.
      const clean =
        sizeAxis.values.includes(size)
          ? size
          : sizeAxis.values.includes(size.slice(1))
            ? size.slice(1)
            : size;
      sel[sizeAxisName] = clean;
    }
    const key = buildAttributeKey(sel);
    return map[key] ?? null;
  }, [nonSizeAttrGroups.length, attrSel, size, sizeAxisName, sizeAxis, product.variantsByAttributeKey]);

  // Stock of the exact variant the parent has picked. With a Colour axis
  // the size-keyed map cannot tell "White S" from "Blue S", so ask the
  // resolved variant first.
  const attrResolvedStock = resolvedAttrVariantId
    ? stockByVariantId.get(resolvedAttrVariantId)
    : undefined;
  const sizeOutOfStock =
    attrResolvedStock !== undefined ? attrResolvedStock <= 0 : sizeKeyedOutOfStock;

  // Sizes that are sold out for the CURRENT colour (or other non-size
  // choice) — rendered struck through with a "Sold out" title, the same
  // treatment the single-axis pills already give. Falls back to the
  // size-keyed map when there is no attribute lookup.
  const soldOutSizes = useMemo<Set<string>>(() => {
    const out = new Set<string>();
    if (!sizeAxis || !sizeAxisName) return out;
    const map = product.variantsByAttributeKey ?? {};
    const hasMap = Object.keys(map).length > 0 && nonSizeAttrGroups.length > 0;
    for (const v of sizeAxis.values) {
      let stock: number | undefined;
      if (hasMap) {
        const sel: Record<string, string> = { ...attrSel, [sizeAxisName]: v };
        const id = map[buildAttributeKey(sel)];
        stock = id ? stockByVariantId.get(id) : undefined;
      } else {
        stock = product.variantStocks?.[v];
      }
      if (stock !== undefined && stock <= 0) out.add(v);
    }
    return out;
  }, [sizeAxis, sizeAxisName, attrSel, nonSizeAttrGroups.length, product.variantsByAttributeKey, product.variantStocks, stockByVariantId]);

  const canAdd = useMultiAxisPicker
    ? Boolean(resolvedVariantId) && product.inStock && !resolvedVariantOutOfStock
    : !noSizesAvailable && size && product.inStock && !sizeOutOfStock;
  // What the Add-to-cart button says: the whole product sold out, or the
  // size (and colour) the parent has picked.
  const selectedOutOfStock =
    !product.inStock || (useMultiAxisPicker ? resolvedVariantOutOfStock : sizeOutOfStock);

  const handleAdd = async () => {
    if (!canAdd || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    // Bookkits / book sets carry a single SKU with no real size axis
    // (variant size is the placeholder "Standard" and there are no
    // product_variant_attributes rows). The legacy size-based variant
    // lookup at /api/shop/variant can't resolve them, so use the variant
    // id the PDP DTO already ships in `variantIds`.
    const kitVariantId =
      product.kind === "kit" || product.isKit === true
        ? product.variantIds?.[size] ??
          Object.values(product.variantIds ?? {})[0] ??
          null
        : null;
    // Send the chosen quantity in ONE request. The previous code fired
    // `qty` parallel +1 POSTs (Promise.all of N adders), which race on the
    // (cart_id, variant_id) upsert and lost-update each other — the final
    // cart qty could land BELOW what the parent selected (the "quantity
    // jumping" report). addByVariantId / add both take a qty the server
    // upserts atomically, so one call is correct and race-free.
    const addOnce =
      useMultiAxisPicker && resolvedVariantId
        ? () => addByVariantId(resolvedVariantId, qty)
        : resolvedAttrVariantId
          ? () => addByVariantId(resolvedAttrVariantId, qty)
          : kitVariantId
            ? () => addByVariantId(kitVariantId, qty)
            : () => add(product, size, qty);
    const result = await addOnce();
    setAddBusy(false);
    if (!result.ok) {
      setAddError(result.error ?? "Could not add to cart");
      return;
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  // When the multi-axis picker has resolved a variant, the displayed
  // price + MRP need to track THAT variant — not the legacy `size`
  // state (which is `""` for kit-like products). `variantPrices` is
  // keyed by the variant's `size` column, and `variantIds` maps size
  // → variantId; reverse that map to look up the size for the resolved
  // variant. Without this, every combination of subjects shows the
  // template-level fallback price (e.g. ₹6,735) instead of its own.
  const resolvedSize =
    useMultiAxisPicker && resolvedVariantId
      ? // Prefer the resolved variant's own `size` column (authoritative)
        // over a value-based reverse-lookup of `variantIds`, whose `.find()`
        // returns the FIRST id match and can pick the wrong size if the map
        // reordered on a refetch or two labels share an id.
        (product.variants?.find((v) => v.id === resolvedVariantId)?.size ??
          Object.entries(product.variantIds ?? {}).find(
            ([, vid]) => vid === resolvedVariantId
          )?.[0])
      : null;
  const priceKey = resolvedSize ?? size;

  // For products with a non-size axis (Colour, House, …), `variantPrices`
  // keyed by `size` alone is ambiguous (green-24 / red-24 / white-24 all
  // share the size string "24"). Read the resolved variant's price from
  // `product.variants` directly so per-colour pricing actually surfaces.
  // Falls back through the legacy variantPrices path for products that
  // don't have a non-size axis.
  const resolvedAxisVariant = useMemo(() => {
    if (!resolvedAttrVariantId) return null;
    return product.variants?.find((v) => v.id === resolvedAttrVariantId) ?? null;
  }, [resolvedAttrVariantId, product.variants]);

  // "From ₹X" headline — shown before the customer has picked enough
  // axes for us to know which variant is theirs. Once the resolved
  // variant is known, the headline flips to that variant's exact price.
  const variantPriceRange = useMemo(() => {
    if (!product.variants?.length) return null;
    const prices = product.variants.map((v) =>
      Math.round(v.pricePaise / 100),
    );
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [product.variants]);
  const pricesVary =
    variantPriceRange != null && variantPriceRange.min !== variantPriceRange.max;
  const hasNonSizeAxis = nonSizeAttrGroups.length > 0;
  const needsFullSelection = hasNonSizeAxis && !resolvedAxisVariant;

  const activePrice = resolvedAxisVariant
    ? Math.round(resolvedAxisVariant.pricePaise / 100)
    : (priceKey ? product.variantPrices?.[priceKey]?.price : undefined) ??
      (pricesVary && variantPriceRange ? variantPriceRange.min : product.price);
  const activeMrp =
    resolvedAxisVariant && resolvedAxisVariant.mrpPaise != null
      ? Math.round(resolvedAxisVariant.mrpPaise / 100)
      : (priceKey ? product.variantPrices?.[priceKey]?.mrp : undefined) ??
        product.mrp;

  const off = activeMrp
    ? Math.round((1 - activePrice / activeMrp) * 100)
    : 0;

  // A ₹0 price is sellable when it's explicit (admin saved an item_prices
  // row at 0 — school-included freebies like belts/caps). Only "price was
  // never set" should gate the buy button. `priced` arrives per variant;
  // a positive price is always considered priced for legacy paths that
  // don't carry the flag.
  const activePriced = resolvedAxisVariant
    ? (resolvedAxisVariant.priced ?? resolvedAxisVariant.pricePaise > 0)
    : priceKey && product.variantPrices?.[priceKey]
      ? (product.variantPrices[priceKey].priced ??
        product.variantPrices[priceKey].price > 0)
      : activePrice > 0;

  return (
    <div className="lg:sticky lg:top-28 lg:self-start">
      {/* eyebrow — use a category-aware label so misclassified bookkits
          don't show "Uniform" as the eyebrow. */}
      <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-brand">
        {product.kind === "kit" ||
        product.kind === "set" ||
        /book[\s-]?(kit|set)|bookset|bookkit/i.test(product.name)
          ? "Book Kit"
          : product.categoryPath[product.categoryPath.length - 2] ?? "Uniform"}
      </p>

      {/* name */}
      <h1 className="mt-2 font-display text-[28px] sm:text-[34px] lg:text-[40px] font-extrabold tracking-tight text-ink-900 leading-[1.05]">
        {product.name}
      </h1>

      {/* rating */}
      {product.rating && (
        <div className="mt-3 flex items-center gap-2 text-[13px]">
          <span className="inline-flex items-center gap-1 text-ink-900 font-semibold">
            <Star className="h-3.5 w-3.5 fill-brand text-brand" />
            {product.rating.score.toFixed(1)}
          </span>
          <span className="text-ink-300">·</span>
          <a
            href="#reviews"
            className="text-ink-500 hover:text-ink-900 transition-colors"
          >
            {product.rating.count} reviews
          </a>
          <span className="text-ink-300">·</span>
          {sizeOutOfStock ? (
            <span className="inline-flex items-center gap-1 text-red-600 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              Size {size} sold out
            </span>
          ) : variantStock !== undefined && variantStock <= 5 ? (
            <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Only {variantStock} left in {size}
            </span>
          ) : variantStock !== undefined && variantStock <= 10 ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {variantStock} in stock
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              In stock
            </span>
          )}
        </div>
      )}

      {/* tagline */}
      {product.tagline && (
        <p className="mt-4 text-[15px] leading-relaxed text-ink-600 max-w-prose">
          {product.tagline}
        </p>
      )}

      {/* price */}
      <div className="mt-6 flex items-baseline gap-3">
        {!activePriced ? (
          // No item_prices row for the resolved variant AND no fallback
          // base_price set — surface this honestly instead of "₹0", which
          // parents read as "free". Add-to-cart is disabled below in the
          // same !activePriced branch.
          <span className="font-display text-[24px] font-extrabold tracking-tight text-ink-500">
            Price coming soon
          </span>
        ) : activePrice <= 0 ? (
          // Explicitly priced at ₹0 — a school-included freebie.
          <span className="font-display text-[34px] font-extrabold tracking-tight text-ink-900">
            Free
          </span>
        ) : (
          <>
            {needsFullSelection && pricesVary ? (
              <span className="text-[14px] font-semibold tracking-wide uppercase text-ink-500">
                From
              </span>
            ) : null}
            <span className="font-display text-[34px] font-extrabold tracking-tight text-ink-900">
              ₹{activePrice.toLocaleString()}
            </span>
            {activeMrp && (
              <>
                <span className="text-[16px] line-through text-ink-400">
                  ₹{activeMrp.toLocaleString()}
                </span>
                <span className="rounded-full bg-brand-50 border border-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand">
                  {off}% OFF
                </span>
              </>
            )}
          </>
        )}
      </div>
      {!activePriced && (
        <p className="mt-1 text-[12px] text-ink-500">
          This combination isn&apos;t priced yet. Pick another colour or size.
        </p>
      )}

      {/* Inline size-chart card. Visible directly below the price so parents
          can compare measurements before they pick a size, without scrolling
          to the bottom-of-page accordion. Click to enlarge. Hidden when no
          chart is configured (accessories, kits, bookkits) OR when the
          product is a category that doesn't need a size chart even if one
          was set in admin (bookkits, caps, shoes, bags, ties, belts). */}
      {product.sizeChartUrl && !isNoSizeChartCategory(product) && (
        <button
          type="button"
          onClick={() => setChartOpen(true)}
          className="mt-4 w-full text-left rounded-2xl border border-ink-100 bg-white p-3 flex items-center gap-3 hover:border-ink-900 transition-colors group"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.sizeChartUrl}
            alt={`${product.name} size guide`}
            className="h-20 w-20 sm:h-24 sm:w-24 object-contain rounded-lg bg-cream-50 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ink-900">
              <Ruler className="h-3.5 w-3.5 text-brand" />
              Size guide
            </p>
            <p className="mt-1 text-[12px] text-ink-500 leading-snug">
              Measure your child at home — tap to enlarge.
            </p>
          </div>
          <span className="text-[11px] font-semibold text-brand group-hover:underline shrink-0">
            View →
          </span>
        </button>
      )}

      {/* Item-Variant template picker (e.g. SMS Grade 11 Bookkit).
          Owns every axis and resolves to a single variant via the map. */}
      {useMultiAxisPicker && (
        <MultiAttributePicker
          groups={multiAxisGroups}
          variantsByAttributeKey={variantMap}
          onResolve={setResolvedVariantId}
        />
      )}

      {/* Legacy multi-attribute selectors (Uniform Colors + Shirt Size,
          etc.) — kept for products whose variants don't have a complete
          attribute lookup map yet. */}
      {!useMultiAxisPicker && effectiveAttributeGroups.map((group) => {
        const isSize = /size|sizes/i.test(group.name);
        return (
          <AttributeGroupPicker
            key={group.name}
            name={group.name}
            values={group.values}
            isSize={isSize}
            selectedSize={size}
            onSelectSize={setSize}
            attrValue={attrSel[group.name] ?? group.values[0] ?? ""}
            onAttrChange={(v) => setAttrSel((s) => ({ ...s, [group.name]: v }))}
            availableValues={isSize ? availableSizes : null}
            soldOutValues={isSize ? soldOutSizes : null}
          />
        );
      })}

      {/* language / stream selector (template variants) */}
      {hasTplVariants && (() => {
        // Convert template variants to the shape parseBookkitLangs expects.
        const asVariants = tplVariants.map((v) => ({
          id: v.id,
          size: v.attributeValue ?? v.name,
        }));
        const langPairs = parseBookkitLangs(asVariants);

        if (langPairs) {
          // Find the variant that matches the current slug (this PDP is one of the variants).
          const activePair = langPairs.find((p) =>
            tplVariants.find((v) => v.id === p.variantId)?.slug === product.slug
          ) ?? null;
          const secondLangs = [...new Set(langPairs.map((p) => p.secondLang))].sort();

          return (
            <div className="mt-7 space-y-4">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500 mb-2">
                  2nd Language
                </p>
                <div className="flex flex-wrap gap-2">
                  {secondLangs.map((lang) => {
                    const pair = langPairs.find((p) => p.secondLang === lang)!;
                    const tv = tplVariants.find((v) => v.id === pair.variantId)!;
                    const active = activePair?.secondLang === lang;
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => router.push(`/shop/${tv.slug}${studentQuery}`)}
                        className={
                          "rounded-lg border px-4 py-2 text-[14px] transition " +
                          (active
                            ? "border-brand bg-brand text-white font-bold shadow-sm"
                            : "border-ink-200 text-ink-700 font-medium hover:border-ink-900")
                        }
                      >
                        {lang}
                      </button>
                    );
                  })}
                </div>
              </div>
              {activePair && (
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500 mb-2">
                    3rd Language
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="rounded-lg border border-brand bg-brand/10 text-brand-700 font-bold px-4 py-2 text-[14px]">
                      {activePair.thirdLang}
                    </span>
                    <span className="text-[11px] text-ink-400">auto-selected</span>
                  </div>
                </div>
              )}
            </div>
          );
        }

        // Generic flat-list fallback for non-language template variants.
        return (
          <div className="mt-7">
            <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-900">
              {tplVariants[0].attributeName ?? "Select option"}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {tplVariants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => router.push(`/shop/${v.slug}${studentQuery}`)}
                  className="group flex items-center justify-between rounded-xl border border-ink-200 bg-white px-4 py-3 text-left hover:border-ink-900 transition-colors"
                >
                  <span className="flex items-center gap-3">
                    <span className="grid h-4 w-4 place-items-center rounded-full border border-ink-300 group-hover:border-ink-900">
                      <span className="h-1.5 w-1.5 rounded-full" />
                    </span>
                    <span className="text-[14px] font-medium text-ink-800">
                      {v.attributeValue ?? v.name}
                    </span>
                  </span>
                  <span className="text-[13px] font-semibold text-ink-900">
                    ₹{v.price.toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* size selector (only when this product has size SKUs — Bookkits skip).
          Suppressed if attribute_groups already rendered the size picker
          or if the multi-axis Item-Variant picker is active. */}
      {!hasTplVariants && !useMultiAxisPicker && effectiveAttributeGroups.every((g) => !/size|sizes/i.test(g.name)) && (
      <div className="mt-7">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-ink-900">
            Size <span className="text-ink-500 font-normal">· {size}</span>
          </p>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {product.sizes.map((s) => {
            const active = s === size;
            const stock = product.variantStocks?.[s];
            const oos = stock !== undefined && stock <= 0;
            const low = stock !== undefined && stock > 0 && stock <= 5;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                title={
                  oos
                    ? "Sold out"
                    : stock !== undefined
                    ? `${stock} left`
                    : undefined
                }
                className={
                  "relative h-11 min-w-11 px-4 rounded-md border text-[14px] font-semibold transition-all " +
                  // Sold-out sizes stay selectable: picking one turns the
                  // Add-to-cart button into "Out of stock".
                  (active
                    ? "bg-ink-900 text-white border-ink-900" + (oos ? " line-through" : "")
                    : oos
                    ? "bg-cream-50 text-ink-400 border-ink-200 line-through hover:border-ink-900"
                    : "bg-white text-ink-800 border-ink-200 hover:border-ink-900")
                }
              >
                {s}
                {low && !active && (
                  <span className="absolute -top-1.5 -right-1.5 grid h-4 min-w-4 px-1 place-items-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                    {stock}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {noSizesAvailable && !hasTplVariants ? (
        <div className="mt-7 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          This product currently has no available sizes.
        </div>
      ) : null}

      {/* qty + buttons */}
      <div className="mt-7 flex flex-col sm:flex-row gap-3">
        <QtyStepper value={qty} onChange={setQty} />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd || addBusy || !activePriced}
          className={
            "flex-1 inline-flex items-center justify-center gap-2 rounded-full px-6 h-12 text-[14px] font-bold active:scale-[0.99] transition-all disabled:cursor-not-allowed " +
            // Sold out is a message, not a dimmed button: keep it fully
            // legible in the warning colour rather than fading it to 40%.
            (selectedOutOfStock && !added
              ? "bg-red-50 text-red-700 border-2 border-red-300 disabled:opacity-100 tracking-wide uppercase"
              : "bg-brand text-white hover:bg-brand-600 disabled:opacity-40 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]")
          }
        >
          <AnimatePresence mode="wait">
            {added ? (
              <motion.span
                key="ok"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="inline-flex items-center gap-2"
              >
                <Check className="h-4 w-4" /> Added to cart
              </motion.span>
            ) : selectedOutOfStock ? (
              <motion.span
                key="oos"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="inline-flex items-center gap-2"
              >
                <ShoppingBag className="h-4 w-4" />
                Out of stock
              </motion.span>
            ) : !activePriced ? (
              <motion.span
                key="nopx"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="inline-flex items-center gap-2"
              >
                <ShoppingBag className="h-4 w-4" />
                Not available
              </motion.span>
            ) : (
              <motion.span
                key="add"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="inline-flex items-center gap-2"
              >
                <ShoppingBag className="h-4 w-4" />
                {activePrice <= 0
                  ? "Add to cart · Free"
                  : `Add to cart · ₹${(activePrice * qty).toLocaleString()}`}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {addError && (
        <p className="mt-2 text-[15px] font-semibold text-red-600 text-center leading-snug">{addError}</p>
      )}

      <button
        type="button"
        onClick={() => setLiked(!liked)}
        className={
          "mt-3 w-full inline-flex items-center justify-center gap-2 rounded-full border h-11 text-[13px] font-semibold transition-all " +
          (liked
            ? "border-brand text-brand bg-brand-50"
            : "border-ink-200 text-ink-800 hover:border-ink-900 bg-white")
        }
      >
        <Heart
          className={`h-4 w-4 transition-all ${liked ? "fill-brand" : ""}`}
        />
        {liked ? "Saved to wishlist" : "Save for later"}
      </button>

      {/* trust strip */}
      <ul className="mt-7 grid grid-cols-2 gap-x-4 gap-y-3 pt-6 border-t border-ink-100">
        {trust.map((t) => (
          <li key={t.label} className="flex items-start gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 border border-brand-100 text-brand">
              <t.icon className="h-3.5 w-3.5" />
            </span>
            <span className="text-[12.5px] font-medium text-ink-700 leading-snug">
              {t.label}
            </span>
          </li>
        ))}
      </ul>

      {/* Enlarge-on-click size-chart modal. Rendered via createPortal to
          document.body so any transformed / will-change ancestor (Gallery's
          hover scale, sticky BuyBox column, framer-motion wrappers) can't
          trap the fixed-position overlay and let the product image bleed
          through underneath. */}
      {chartOpen && product.sizeChartUrl && portalReady &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm grid place-items-center px-4"
            onClick={() => setChartOpen(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 p-4 sm:p-5 border-b border-ink-100 sticky top-0 bg-white">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 border border-brand-100 text-brand">
                    <Ruler className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-display text-[16px] font-bold text-ink-900">
                      Size guide
                    </p>
                    <p className="text-[12px] text-ink-500">{product.name}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setChartOpen(false)}
                  aria-label="Close"
                  className="grid h-8 w-8 place-items-center rounded-full text-ink-500 hover:bg-cream-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4 sm:p-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={product.sizeChartUrl}
                  alt={`${product.name} size chart`}
                  className="w-full h-auto object-contain rounded-xl border border-ink-100"
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function AttributeGroupPicker({
  name,
  values,
  isSize,
  selectedSize,
  onSelectSize,
  attrValue,
  onAttrChange,
  availableValues,
  soldOutValues,
}: {
  name: string;
  values: string[];
  /** True when this group is a size group — its clicks set the cart size. */
  isSize: boolean;
  selectedSize: string;
  onSelectSize: (s: string) => void;
  /** Non-size attribute current value, controlled by BuyBox so add-to-cart
   *  can read it. Required when isSize is false. */
  attrValue?: string;
  onAttrChange?: (v: string) => void;
  /** When set, values NOT in this set are still rendered but disabled — so
   *  a parent shopping for "blue" sees that "30" exists in the catalog but
   *  isn't stocked in blue. Null = no filtering (all values enabled). */
  availableValues?: Set<string> | null;
  /** Sizes with nothing on the shelf for the current colour — rendered
   *  struck through and titled "Sold out"; still visible so the parent
   *  sees the size exists. */
  soldOutValues?: Set<string> | null;
}) {
  const value = isSize ? selectedSize : attrValue ?? values[0] ?? "";
  const setValue = isSize ? onSelectSize : (onAttrChange ?? (() => {}));
  // Sizes are displayed clean (e.g. "28", "2XL", "L", "XL", "34-22") but some
  // products store them prefixed in product_variants ("V28", "L2XL", "Q34-22").
  // Resolve the active clean value against the actual `values` list: prefer
  // an exact match (so "XL" stays "XL"); only fall back to single-char strip
  // when the stripped form is itself one of the known values. Without this
  // an indiscriminate strip turned "XL" → "L" and lit up both pills.
  const cleanValue = isSize
    ? values.includes(value)
      ? value
      : value && values.includes(value.slice(1))
        ? value.slice(1)
        : value
    : value;
  const prefix =
    isSize && selectedSize.length > cleanValue.length
      ? selectedSize.slice(0, selectedSize.length - cleanValue.length)
      : "";
  return (
    <div className="mt-7">
      <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-900">
        {name}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {values.map((v) => {
          const active = v === cleanValue;
          const soldOut = !!soldOutValues?.has(v);
          const unavailable = availableValues != null && !availableValues.has(v);
          // A sold-out size stays selectable (user's call, 2026-09-16): picking
          // it turns the Add-to-cart button into "Out of stock", which is the
          // clearer message. Only a size that does not exist in this colour
          // is disabled.
          return (
            <button
              key={v}
              type="button"
              onClick={() => {
                if (unavailable) return;
                setValue(isSize ? `${prefix}${v}` : v);
              }}
              disabled={unavailable}
              title={soldOut ? "Sold out" : unavailable ? "Not available for the selected colour" : undefined}
              className={
                "h-11 min-w-11 px-4 rounded-md border text-[13px] font-semibold transition-all " +
                (unavailable
                  ? "bg-ink-50 text-ink-300 border-ink-100 line-through cursor-not-allowed"
                  : active
                    ? "bg-ink-900 text-white border-ink-900" + (soldOut ? " line-through" : "")
                    : soldOut
                      ? "bg-white text-ink-400 border-ink-200 line-through hover:border-ink-900"
                      : "bg-white text-ink-800 border-ink-200 hover:border-ink-900")
              }
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}
