"use client";

/**
 * Customer-facing exchange request form.
 *
 * Order-level flow: the page hands us a flat `units` list covering
 * every exchangeable thing in the order — standalone variants and
 * kit/Magic-Box components alike. The customer ticks every unit they
 * want exchanged; each ticked unit becomes its own tab with its own
 * Reason → Sub-reason → Replacement. Submit fires one /api/returns per
 * tab so each unit carries its own reason and (optional) replacement.
 */

import { useState, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload, X, AlertCircle, Loader2, CheckCircle2, ArrowLeft,
} from "lucide-react";
import {
  PHOTO_CATEGORIES,
  type ExchangeReason,
} from "@/lib/exchange-shared";
import { getReasonOptions } from "@/lib/exchange-reasons";
import { fetchOrNetworkError, errorMessageFor } from "@/lib/client-fetch";
import { snapshotPhoto } from "@/lib/photo-snapshot";
import {
  clampRequestedQty,
  exceedsQtyCeiling,
  qtyCapMessage,
} from "@/lib/return-qty";
import { useQtyCapToast } from "@/components/shop/orders/QtyCapToast";

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

export type Unit = {
  unitKey: string;
  orderItemId: string;
  parentName: string;
  parentImage: string | null;
  parentHeadLabel: string;
  isKitComponent: boolean;
  /** The kit/Magic-Box order item itself — selecting it = whole-box exchange. */
  isKitParent?: boolean;
  name: string;
  size: string;
  qty: number;
  variantId: string;
  imageUrl: string | null;
  kind: string;
  attributes: { name: string; value: string }[];
  hasSiblings: boolean;
  siblings: SiblingLite[];
  /** True when this magic-box component's exact ordered size/variant
   *  wasn't stored (recovered from the bundle definition). The form asks
   *  the parent which size they currently have before choosing a swap. */
  currentUnknown?: boolean;
  /** Bookkit drill-down: the category (sub_bundle) this leaf book sits under.
   *  Present only on bookkit component units — drives the category accordion
   *  inside the kit card. Absent on magic-box / plain units. */
  categoryKey?: string | null;
  categoryName?: string | null;
  // For a bookkit nested inside a magic box: its key + name, so the form nests
  // the bookkit's categories under a bookkit header (not flat with uniforms).
  bookkitKey?: string | null;
  bookkitName?: string | null;
  // True when an earlier exchange for this order_item is still active
  // (status ∈ {requested, approved}). The picker disables it and shows
  // the existing RTN number so the customer doesn't try to re-submit.
  locked?: boolean;
  lockReturnNumber?: string | null;
  // Kit-parent only: some (but not all) components inside the box are already
  // in a request. The box stays open for the rest; drives the explanatory note
  // on the kit card. (Whole-box exchange itself is retired — see kitGroupCard.)
  someComponentsLocked?: boolean;
  // Bookkit book whose parcel hasn't arrived yet — greyed with a "not delivered
  // yet" note; becomes selectable automatically once the parcel is delivered.
  notDelivered?: boolean;
  // Kit-parent only: some components aren't delivered yet.
  someComponentsUndelivered?: boolean;
  /** How many of this line are still requestable when an earlier,
   *  non-rejected request already covers part of a multi-qty line. Absent =
   *  nothing outstanding → the ceiling is the full ordered `qty`. (Today the
   *  per-component lock takes a line out entirely, so the page doesn't set
   *  this; the picker honours it the moment it does.) */
  remainingQty?: number | null;
  /** The RTN-/MIS- number that covers the rest, named in the cap toast. */
  remainingCoveredByRef?: string | null;
};

type StagedPhoto = {
  file: File;
  category: string;
  previewUrl: string;
};

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per photo
// HEIC/HEIF are included so iPhone photos (the default capture format) upload
// without forcing users to switch to "Most Compatible". No per-section or
// total count limit — every section accepts as many photos as the customer
// wants. Browsers frequently report an empty/odd MIME type for HEIC, so the
// gate also falls back to the filename extension (see isAllowedImage).
const ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const isAllowedImage = (f: File): boolean => {
  if (ALLOWED.includes(f.type)) return true;
  const name = f.name.toLowerCase();
  return ALLOWED_EXT.some((ext) => name.endsWith(ext));
};

type ReplacementMode = "sibling" | "same_fresh" | "different_describe";

type TabState = {
  reason: ExchangeReason | "";
  subReason: string;
  damageLocation: string;
  wrongItemFault: "" | "fulfillment" | "customer";
  replacementMode: ReplacementMode | "";
  requestedVariantId: string;
  /** Colour/size the customer wants instead (2026-07-09). Reason-driven:
   *  a "wrong colour" reason surfaces the Colour picker, a "wrong size" reason
   *  the Size picker; both may be set. Empty = keep the ordered value. The
   *  matching sibling variant is resolved into `requestedVariantId`. */
  requestedColor: string;
  requestedSize: string;
  /** The size the parent currently HAS — only collected for components
   *  whose ordered variant wasn't stored (unit.currentUnknown). */
  currentVariantId: string;
  replacementDescribe: string;
  /** How many of this line to exchange, when it was ordered qty > 1 (e.g.
   *  "Crown 50 Pages … × 2" but only one is damaged). 0 = unset → the full
   *  ordered qty. */
  qty: number;
  /** What's literally in the Qty box. `null` = untouched (show the numeric
   *  value). Held separately so a half-typed or EMPTY box survives until
   *  blur — a purely numeric controlled input stamps "1" back the instant
   *  the customer clears it, and their next digit lands as "1X". */
  qtyText: string | null;
  notes: string;
};

const emptyTab = (): TabState => ({
  reason: "",
  subReason: "",
  damageLocation: "",
  wrongItemFault: "",
  replacementMode: "",
  requestedVariantId: "",
  requestedColor: "",
  requestedSize: "",
  currentVariantId: "",
  replacementDescribe: "",
  qty: 0,
  qtyText: null,
  notes: "",
});

/**
 * The most this line may be exchanged for: the outstanding remainder when an
 * earlier request already covers part of it, else the ordered quantity.
 * Never below 1 — a unit that's fully covered isn't selectable at all.
 */
function qtyCeiling(unit: Unit): number {
  const remaining =
    typeof unit.remainingQty === "number" && unit.remainingQty > 0
      ? unit.remainingQty
      : null;
  return Math.max(1, Math.floor(remaining ?? unit.qty ?? 1));
}

/** Effective exchange quantity for a line: the tab's chosen qty (clamped to
 *  1..ceiling), or the full ceiling when unset (0). Applied again at submit
 *  so a stale / tampered tab state can't build an over-qty payload. */
function effectiveQty(unit: Unit, tab: TabState): number {
  const ceiling = qtyCeiling(unit);
  if (tab.qty && tab.qty > 0) return clampRequestedQty(tab.qty, ceiling);
  return ceiling;
}

function categoryLabel(kind: string): string {
  switch (kind) {
    case "book": return "Books";
    case "uniform": return "Uniform";
    case "accessory": return "Accessories";
    case "kit": return "Kit";
    case "sub_bundle": return "Bundle items";
    case "magic_box": return "Magic Box";
    case "consumable": return "Consumables";
    default: return "Other";
  }
}

function unitDetailLabel(u: Unit): string {
  const parts: string[] = [];
  const attrs = Array.isArray(u.attributes) ? u.attributes : [];
  if (attrs.length > 0) {
    parts.push(attrs.map((a) => a.value).join(" · "));
  } else if (u.size) {
    parts.push(`Size ${u.size}`);
  }
  if (u.qty > 1) parts.push(`× ${u.qty}`);
  return parts.join(" · ");
}

function unitFullLabel(u: Unit): string {
  const detail = unitDetailLabel(u);
  return detail ? `${u.name} · ${detail}` : u.name;
}

function siblingDropdownLabel(s: SiblingLite): string {
  const axes = Array.isArray(s.axes) ? s.axes : [];
  if (axes.length === 0) return s.size ? `Size ${s.size}` : s.sku;
  return axes
    .slice()
    .sort((a, b) => a.attributeName.localeCompare(b.attributeName))
    .map((a) => `${a.attributeName}: ${a.value}`)
    .join(" · ");
}

export function ExchangeForm({
  orderId,
  orderNumber,
  units,
}: {
  orderId: string;
  orderNumber: string;
  units: Unit[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const singleUnit = units.length === 1;

  // ── State ─────────────────────────────────────────────────────
  const [selectedIdxs, setSelectedIdxs] = useState<number[]>(
    singleUnit ? [0] : []
  );
  const [selectionConfirmed, setSelectionConfirmed] = useState<boolean>(singleUnit);

  // Tab states keyed by selected unit's index (stringified).
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});
  const [activeTab, setActiveTab] = useState<string>(singleUnit ? "0" : "");

  const cur = tabStates[activeTab] ?? emptyTab();
  const updateActive = (patch: Partial<TabState>) =>
    setTabStates((prev) => ({
      ...prev,
      [activeTab]: { ...(prev[activeTab] ?? emptyTab()), ...patch },
    }));

  const reason = cur.reason;
  const subReason = cur.subReason;
  const damageLocation = cur.damageLocation;
  const wrongItemFault = cur.wrongItemFault;
  const replacementMode = cur.replacementMode;
  const requestedVariantId = cur.requestedVariantId;
  const requestedColor = cur.requestedColor;
  const requestedSize = cur.requestedSize;
  const currentVariantId = cur.currentVariantId;
  const qty = cur.qty;
  const notes = cur.notes;

  const setReason = (v: ExchangeReason | "") => updateActive({ reason: v });
  const setSubReason = (v: string) => updateActive({ subReason: v });
  const setDamageLocation = (v: string) => updateActive({ damageLocation: v });
  const setWrongItemFault = (v: "" | "fulfillment" | "customer") =>
    updateActive({ wrongItemFault: v });
  const setReplacementMode = (
    v: ReplacementMode | "" | ((prev: ReplacementMode | "") => ReplacementMode | "")
  ) =>
    updateActive({
      replacementMode: typeof v === "function" ? v(cur.replacementMode) : v,
    });
  const setRequestedVariantId = (v: string) => updateActive({ requestedVariantId: v });
  const setRequestedColor = (v: string) => updateActive({ requestedColor: v });
  const setRequestedSize = (v: string) => updateActive({ requestedSize: v });
  const setCurrentVariantId = (v: string) => updateActive({ currentVariantId: v });
  // Keeps the box's text in step with the ± buttons.
  const setQty = (v: number) => updateActive({ qty: v, qtyText: String(v) });
  const setNotes = (v: string) => updateActive({ notes: v });

  // Explains a quantity clamp ("Only 1 of \"SMS Caps\" was ordered.") — a
  // silent jump-back reads as a broken input.
  const { toast: qtyToast, showQtyCapToast } = useQtyCapToast();

  const [staging, setStaging] = useState<string>("");
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Photos already staged by an attempt whose create call then failed.
   *  Set once the upload leg succeeds so a retry skips straight to create. */
  const uploadedPhotosRef = useRef<
    { url: string; key: string; category: string }[] | null
  >(null);

  // ── Kit / Magic Box grouping ──────────────────────────────────
  // A kit order item arrives as one "parent" unit (whole-box exchange)
  // plus one unit per component, all sharing orderItemId. The picker
  // collapses each such family into a single card with a scope chooser:
  // "the whole box" vs "only some items inside".
  const kitGroups = useMemo(() => {
    const map = new Map<string, { parentIdx: number; compIdxs: number[] }>();
    units.forEach((u, idx) => {
      if (!u.isKitParent && !u.isKitComponent) return;
      const g = map.get(u.orderItemId) ?? { parentIdx: -1, compIdxs: [] };
      if (u.isKitParent) g.parentIdx = idx;
      else g.compIdxs.push(idx);
      map.set(u.orderItemId, g);
    });
    // The chooser only makes sense when both halves exist.
    return new Map(
      [...map].filter(([, g]) => g.parentIdx >= 0 && g.compIdxs.length > 0)
    );
  }, [units]);

  // ── Bookkit category grouping (3-level: kit → category → books) ──────
  // For bookkit kit-groups whose components carry a `categoryName`, the
  // "some items inside" list is itself grouped into expandable categories,
  // each with a "whole category" checkbox that ticks/unticks every book in
  // it. Non-bookkit kits (magic boxes) have no categoryName → they render
  // the existing flat component list unchanged.
  const categoriesFor = (compIdxs: number[]) => {
    const groups = new Map<string, { name: string; idxs: number[] }>();
    for (const ci of compIdxs) {
      const u = units[ci];
      const key = u?.categoryKey ?? null;
      if (!key) continue;
      const g = groups.get(key) ?? { name: u!.categoryName ?? "Items", idxs: [] };
      g.idxs.push(ci);
      groups.set(key, g);
    }
    return groups;
  };

  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const toggleCategoryOpen = (catKey: string) =>
    setOpenCategories((p) => ({ ...p, [catKey]: !p[catKey] }));

  // A unit can't be selected/deselected when it's locked (already in a
  // request) or not yet delivered.
  const isUnitDisabled = (i: number): boolean => {
    const u = units[i];
    return !!u && (!!u.locked || !!u.notDelivered);
  };

  const setCategorySelected = (idxs: number[], selected: boolean) => {
    setSelectionConfirmed(false);
    setSelectedIdxs((prev) => {
      const set = new Set(prev);
      for (const i of idxs) {
        if (isUnitDisabled(i)) continue; // never toggle a disabled unit
        if (selected) set.add(i);
        else set.delete(i);
      }
      return Array.from(set);
    });
  };

  // ── Derived ───────────────────────────────────────────────────
  const tabKeys = useMemo(
    () => selectedIdxs.map(String),
    [selectedIdxs]
  );

  // Keep activeTab pointing at a valid key when selection changes.
  useEffect(() => {
    if (tabKeys.length === 0) {
      if (activeTab) setActiveTab("");
      return;
    }
    if (!tabKeys.includes(activeTab)) setActiveTab(tabKeys[0]);
  }, [tabKeys, activeTab]);

  const activeUnitIdx = activeTab === "" ? null : parseInt(activeTab, 10);
  const activeUnit: Unit | null =
    activeUnitIdx !== null && Number.isFinite(activeUnitIdx)
      ? units[activeUnitIdx] ?? null
      : null;

  /** Ceiling for the active tab's Qty box (remainder, else ordered qty). */
  const activeCeiling = activeUnit ? qtyCeiling(activeUnit) : 1;

  /**
   * Single entry point for a typed / pasted / blurred quantity.
   *
   * Two things a bare `max=` can't do:
   *  1. Reject the value — the browser accepts 5 in a max=1 box, which is how
   *     an exchange for 2 × "SMS Caps" got raised on a × 1 line.
   *  2. Re-sync the DOM. React skips writing `value` when the clamped number
   *     equals the state it already holds, so the typed "5" would stay on
   *     screen while state said 1. Write it back on the node directly (keeps
   *     the caret / focus, unlike a remount).
   */
  const applyQtyInput = (
    el: HTMLInputElement,
    unit: Unit,
    phase: "change" | "blur",
  ) => {
    const ceiling = qtyCeiling(unit);
    const raw = el.value;
    const over = exceedsQtyCeiling(raw, ceiling);
    const clamped = clampRequestedQty(raw, ceiling);
    if (over) {
      showQtyCapToast(
        qtyCapMessage(unit.name, ceiling, unit.remainingCoveredByRef ?? null),
      );
    }
    // A mid-edit value (empty, "0") is left alone until blur; only an
    // over-the-cap value is corrected on the spot — that's the one the
    // customer needs told about.
    const rewrite = over || phase === "blur";
    if (rewrite && el.value !== String(clamped)) el.value = String(clamped);
    updateActive({ qty: clamped, qtyText: rewrite ? String(clamped) : raw });
  };

  const reasonOpts = useMemo(() => {
    if (!activeUnit) return getReasonOptions("other", false);
    return getReasonOptions(activeUnit.kind, activeUnit.hasSiblings);
  }, [activeUnit]);

  const subReasonChoices = reason ? (reasonOpts.subReasonsByReason[reason] ?? []) : [];
  const damageLocationChoices = reason
    ? (reasonOpts.damageLocationsByReason[reason] ?? [])
    : [];
  const needsDamageLocation = damageLocationChoices.length > 0;

  // ── Colour / Size replacement axes (2026-07-09) ──────────────────────
  // Derive the product's Colour axis + Size options from the active unit and
  // its siblings so a "wrong colour / wrong size" exchange can pick the exact
  // replacement colour and/or size (instead of one opaque variant dropdown).
  const COLOR_RE = /colou?r/i;
  const variantAxes = useMemo(() => {
    if (!activeUnit) return { colorAxis: null as string | null, colors: [] as string[], sizes: [] as string[], origColor: "", origSize: "" };
    const sibs = Array.isArray(activeUnit.siblings) ? activeUnit.siblings : [];
    const own = Array.isArray(activeUnit.attributes) ? activeUnit.attributes : [];
    const colorAxis =
      own.find((a) => COLOR_RE.test(a.name))?.name ??
      sibs.flatMap((s) => s.axes).find((a) => COLOR_RE.test(a.attributeName))?.attributeName ??
      null;
    const origColor = colorAxis ? (own.find((a) => a.name === colorAxis)?.value ?? "") : "";
    const colorSet = new Set<string>();
    if (origColor) colorSet.add(origColor);
    if (colorAxis) for (const s of sibs) {
      const v = s.axes.find((a) => a.attributeName === colorAxis)?.value;
      if (v) colorSet.add(v);
    }
    const sizeSet = new Set<string>();
    if (activeUnit.size) sizeSet.add(activeUnit.size);
    for (const s of sibs) if (s.size) sizeSet.add(s.size);
    return {
      colorAxis,
      colors: Array.from(colorSet),
      sizes: Array.from(sizeSet),
      origColor,
      origSize: activeUnit.size ?? "",
    };
  }, [activeUnit]);

  // Resolve the sibling (or the ordered variant itself) that matches the chosen
  // colour + size, so the request carries a real requestedVariantId.
  const resolveVariantByAxes = (color: string, size: string): string => {
    if (!activeUnit) return "";
    const axis = variantAxes.colorAxis;
    const cands: { id: string; color: string; size: string }[] = [
      { id: activeUnit.variantId, color: variantAxes.origColor, size: activeUnit.size ?? "" },
      ...(Array.isArray(activeUnit.siblings) ? activeUnit.siblings : []).map((s) => ({
        id: s.id,
        color: axis ? (s.axes.find((a) => a.attributeName === axis)?.value ?? "") : "",
        size: s.size ?? "",
      })),
    ];
    const wantColor = color || variantAxes.origColor;
    const wantSize = size || (activeUnit.size ?? "");
    // Size first, then colour — so an unknown colour can't nullify a size that
    // genuinely exists.
    const bySize = cands.filter(
      (c) => !variantAxes.sizes.length || c.size === wantSize,
    );
    if (bySize.length === 0) return "";
    if (!axis) return bySize[0]!.id;
    // Known colour → exact match, but treat a sibling with NO colour binding as
    // compatible (the catalog row simply lacks the attribute; the variant is
    // still the right one).
    if (wantColor) {
      const hit =
        bySize.find((c) => c.color === wantColor) ?? bySize.find((c) => !c.color);
      return hit?.id ?? "";
    }
    // Colour genuinely unknown (a legacy/backfilled bundle_selection with no
    // `attributes` snapshot AND no catalog binding). Resolve only when it is
    // UNAMBIGUOUS — a single-colour product like the Belt or the Hoodie. With
    // several colours we must not guess, or a Yellow-house child could be sent
    // Red: leave it unresolved so the form asks for a colour instead.
    const distinct = Array.from(new Set(bySize.map((c) => c.color).filter(Boolean)));
    if (distinct.length > 1) return "";
    return bySize[0]!.id;
  };

  // Picking a colour/size updates the chosen variant id so the request carries
  // a concrete replacement while also recording the explicit colour/size.
  const chooseColor = (v: string) =>
    updateActive({ requestedColor: v, requestedVariantId: resolveVariantByAxes(v, requestedSize) });
  const chooseSize = (v: string) =>
    updateActive({ requestedSize: v, requestedVariantId: resolveVariantByAxes(requestedColor, v) });

  // Which axis pickers to show, driven by the reason + what the product has.
  // Wrong-colour reasons surface the Colour picker; wrong-size reasons the Size
  // picker; a plain "wrong item" / damaged sibling swap shows whatever exists.
  const wantsColorPick = subReason === "wrong_color" || reason === "wrong_item";
  const wantsSizePick = reason === "wrong_size_delivered" || subReason === "size_chart_mismatch";
  const showColorPicker = !!variantAxes.colorAxis && variantAxes.colors.length > 1 && (wantsColorPick || wantsSizePick);
  const showSizePicker = variantAxes.sizes.length > 1 && (wantsSizePick || wantsColorPick);

  // Sibling picker shows up when the chosen reason calls for it AND
  // the active unit actually has siblings on its own product.
  const siblingAvailable =
    reasonOpts.showSiblingPicker &&
    (Array.isArray(activeUnit?.siblings) ? activeUnit!.siblings.length : 0) > 0;

  // "Same item, fresh piece" is offered for damaged goods (not wrong-item /
  // wrong-size / other). When neither that nor a sibling size picker applies,
  // there's nothing to choose — hide the whole replacement block.
  const sameFreshOffered =
    reason !== "wrong_item" && reason !== "other" && reason !== "wrong_size_delivered";
  const anyReplacementOption = sameFreshOffered || siblingAvailable;

  // Wipe stale replacement mode whenever reason changes.
  useEffect(() => {
    updateActive({ replacementMode: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason]);

  // If reason no longer valid under the active unit's reason set, clear.
  useEffect(() => {
    if (reason && !reasonOpts.reasons.some((r) => r.value === reason)) {
      updateActive({
        reason: "",
        subReason: "",
        damageLocation: "",
        wrongItemFault: "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason, reasonOpts]);

  // ── Photo handling ────────────────────────────────────────────
  const stageFiles = async (category: string, files: FileList | null) => {
    setStaging("");
    if (!files) return;
    setError(null);
    const incoming: StagedPhoto[] = [];
    for (const f of Array.from(files)) {
      if (!isAllowedImage(f)) {
        setError(`"${f.name}" must be a JPEG, PNG, WebP, or HEIC image.`);
        return;
      }
      if (f.size > MAX_BYTES) {
        // Explicit popup so the 50 MB cap is unmissable on large camera
        // files; the inline error stays as a persistent reminder.
        window.alert(
          `"${f.name}" is larger than 50 MB and was not added.\n\nPlease upload a photo under 50 MB.`
        );
        setError(`"${f.name}" exceeds 50 MB and was not added.`);
        return;
      }
      // Copy the bytes NOW. Holding the OS file handle until Submit is what
      // made uploads fail with a bare "Failed to fetch" on Android — see
      // lib/photo-snapshot.ts. A photo we can't read is reported here, while
      // the parent is still on the picker.
      let snapshot: File;
      try {
        snapshot = await snapshotPhoto(f);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : `We couldn't read "${f.name}".`,
        );
        return;
      }
      incoming.push({
        file: snapshot,
        category,
        previewUrl: URL.createObjectURL(snapshot),
      });
    }
    // No count cap — each section accepts unlimited photos.
    uploadedPhotosRef.current = null; // the staged set is now stale
    setPhotos((prev) => [...prev, ...incoming]);
  };

  const removePhoto = (idx: number) => {
    uploadedPhotosRef.current = null; // the staged set is now stale
    setPhotos((prev) => {
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  };

  // ── Validation ───────────────────────────────────────────────
  const validateTab = (tab: TabState, unit: Unit): string | null => {
    const opts = getReasonOptions(unit.kind, unit.hasSiblings);
    const subChoices = tab.reason ? (opts.subReasonsByReason[tab.reason] ?? []) : [];
    const dmgChoices = tab.reason ? (opts.damageLocationsByReason[tab.reason] ?? []) : [];

    if (unit.currentUnknown && !tab.currentVariantId) {
      return "Please tell us which size you currently have.";
    }
    if (!tab.reason) return "Please select a reason.";
    if (tab.reason === "wrong_item" && !tab.wrongItemFault) {
      return "Please tell us whether we sent the wrong item or you ordered the wrong one.";
    }
    // Sub-reason is only asked on the "we sent the wrong item" branch — don't
    // demand it on the "I ordered the wrong thing" branch where it's hidden.
    const subReasonShown =
      subChoices.length > 0 &&
      (tab.reason !== "wrong_item" || tab.wrongItemFault === "fulfillment");
    if (subReasonShown && !tab.subReason) return "Please pick a sub-reason.";
    if (dmgChoices.length > 0 && !tab.damageLocation) {
      return "Please indicate where on the item the issue is.";
    }
    // Only demand a replacement choice when one is actually offered. Damaged
    // items always get "same, fresh piece"; sized products get the sibling
    // picker. A product with no alternate variants (e.g. a book) offers
    // nothing to pick — the correct-item swap is implied, so don't block.
    const sameFreshOffered =
      tab.reason !== "wrong_item" &&
      tab.reason !== "other" &&
      tab.reason !== "wrong_size_delivered";
    const siblingOffered =
      opts.showSiblingPicker &&
      (Array.isArray(unit.siblings) ? unit.siblings.length : 0) > 0;
    if ((sameFreshOffered || siblingOffered) && !tab.replacementMode) {
      return "Please pick what you'd like instead.";
    }
    if (tab.replacementMode === "sibling" && !tab.requestedVariantId) {
      return "Please pick the size / variant you'd like instead.";
    }
    if (tab.reason === "other" && !tab.notes.trim()) {
      return "Please describe the issue in the notes.";
    }
    return null;
  };

  const validateEdit = (): string | null => {
    if (selectedIdxs.length === 0) return "Please pick at least one item to exchange.";
    if (!selectionConfirmed) return "Please confirm the items you selected are correct.";
    for (const key of tabKeys) {
      const idx = parseInt(key, 10);
      const unit = units[idx];
      if (!unit) continue;
      const tab = tabStates[key] ?? emptyTab();
      const err = validateTab(tab, unit);
      if (err) {
        if (tabKeys.length > 1 && key !== activeTab) setActiveTab(key);
        if (tabKeys.length === 1) return err;
        return `${unit.name} — ${err}`;
      }
    }
    if (photos.length === 0) {
      return "Please attach at least one photo so customer care can verify.";
    }
    return null;
  };

  const moveToConfirm = () => {
    const v = validateEdit();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setStep("confirm");
  };

  // ── Submit ────────────────────────────────────────────────────
  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // 1. Upload photos in size-bounded BATCHES rather than one giant
      //    multipart request. With 50 MB photos and no count cap a single
      //    request could be hundreds of MB and get rejected upstream (nginx
      //    client_max_body_size) before reaching the app. We pack files in
      //    order until a batch would exceed BATCH_BYTES, then flush; a single
      //    file larger than the target still goes alone (so nginx only needs
      //    to clear one max-size photo, not the whole bundle). Batches are
      //    sent sequentially and their results concatenated IN ORDER, so the
      //    returned URL index still lines up 1:1 with photos[i].category.
      const BATCH_BYTES = 10 * 1024 * 1024; // ~10 MB target per request
      const batches: StagedPhoto[][] = [];
      let cur: StagedPhoto[] = [];
      let curBytes = 0;
      // Already staged on a previous attempt that died on the create call?
      // Skip straight to the create — re-uploading would only orphan a second
      // copy of every photo in the bucket.
      for (const p of uploadedPhotosRef.current ? [] : photos) {
        if (cur.length > 0 && curBytes + p.file.size > BATCH_BYTES) {
          batches.push(cur);
          cur = [];
          curBytes = 0;
        }
        cur.push(p);
        curBytes += p.file.size;
      }
      if (cur.length > 0) batches.push(cur);

      const uploaded: { url: string; key: string }[] = [];
      for (const batch of batches) {
        const form = new FormData();
        for (const p of batch) form.append("files", p.file, p.file.name);
        // Staging files is safe to repeat (each attempt writes under a fresh
        // timestamped key), so a flaky mobile connection gets a couple of
        // retries here rather than failing the whole submission.
        const upRes = await fetchOrNetworkError(
          `/api/returns/upload?orderId=${orderId}`,
          { method: "POST", body: form },
          { retries: 2 },
        );
        if (!upRes.ok) {
          throw new Error(await errorMessageFor(upRes, "Upload failed"));
        }
        const j = (await upRes.json()) as {
          photos: { url: string; key: string }[];
        };
        uploaded.push(...j.photos);
      }
      const taggedPhotos = uploadedPhotosRef.current ??
        uploaded.map((p, i) => ({
          url: p.url,
          key: p.key,
          category: photos[i]?.category ?? "other",
        }));
      // Remember the staged photos so a retry after a dropped connection
      // re-sends the create call WITHOUT re-uploading every photo — that
      // second upload was the slowest part of the round trip and the most
      // likely to drop again.
      uploadedPhotosRef.current = taggedPhotos;

      // Flatten every tab into one perItem[]. One POST = one RTN bundle,
      // even when the customer flagged many components on the same order_item.
      const perItem: Record<string, unknown>[] = [];
      const composedNotesParts: string[] = [];
      for (const key of tabKeys) {
        const idx = parseInt(key, 10);
        const unit = units[idx];
        if (!unit) continue;
        const tab = tabStates[key] ?? emptyTab();

        const tabNoteLines: string[] = [];
        if (tab.notes.trim()) tabNoteLines.push(tab.notes.trim());
        const tabNotes = tabNoteLines.join("\n");
        if (tabNotes) composedNotesParts.push(`${unit.name}: ${tabNotes}`);

        const item: Record<string, unknown> = {
          orderItemId: unit.orderItemId,
          qty: effectiveQty(unit, tab),
          reason: tab.reason,
        };
        if (tab.subReason) item.subReason = tab.subReason;
        if (tab.damageLocation) item.damageLocation = tab.damageLocation;
        if (tab.replacementMode) item.replacementMode = tab.replacementMode;
        if (tab.replacementMode === "sibling" && tab.requestedVariantId) {
          item.requestedVariantId = tab.requestedVariantId;
        }
        // Explicit colour/size change (2026-07-09) — recorded for customer care
        // so the exchange stores original + requested colour/size, not just an
        // opaque variant id.
        if (tab.replacementMode === "sibling" && (tab.requestedColor || tab.requestedSize)) {
          const origColor =
            (Array.isArray(unit.attributes) ? unit.attributes : []).find((a) =>
              /colou?r/i.test(a.name),
            )?.value ?? "";
          item.variantChange = {
            originalColor: origColor || null,
            originalSize: unit.size || null,
            requestedColor: tab.requestedColor || null,
            requestedSize: tab.requestedSize || null,
          };
        }
        if (tabNotes) item.notes = tabNotes;
        if (unit.isKitComponent) {
          // Surface the bookkit category (e.g. "SMS Grade 9 Hindi") to
          // customer-care by prepending it to the component's attributes —
          // no schema change, and audit already renders these.
          const attrs = unit.categoryName
            ? [{ name: "Category", value: unit.categoryName }, ...unit.attributes]
            : unit.attributes;
          const path: Record<string, unknown> = {
            // For recovered-composition components the ordered variant
            // wasn't stored, so the parent picked their current size above.
            variantId: unit.currentUnknown ? tab.currentVariantId : unit.variantId,
            componentName: unit.name,
            attributes: attrs,
          };
          item.requestedComponentPath = path;
        }
        perItem.push(item);
      }

      const body = {
        orderId,
        kind: "exchange" as const,
        photos: taggedPhotos,
        notes: composedNotesParts.join("\n\n") || undefined,
        perItem,
      };

      // NOT retried: this mints an RTN. If the connection drops after the
      // server committed, a silent retry would create a second request for
      // the same order. The parent retries by tapping Submit again — the
      // staged photos are reused and the server's per-order duplicate guard
      // answers 409 if the first attempt did land.
      const res = await fetchOrNetworkError("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(await errorMessageFor(res, "Submit failed"));
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/shop/orders/${orderId}/exchange/${id}`);
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Something went wrong. Please tap Submit again.",
      );
      setSubmitting(false);
    }
  };

  // ── Render: confirm step ──────────────────────────────────────
  if (step === "confirm") {
    const summaries = tabKeys.map((key) => {
      const idx = parseInt(key, 10);
      const unit = units[idx];
      const tab = tabStates[key] ?? emptyTab();
      const opts = unit
        ? getReasonOptions(unit.kind, unit.hasSiblings)
        : getReasonOptions("other", false);
      const selectedSibling =
        tab.replacementMode === "sibling"
          ? ((Array.isArray(unit?.siblings) ? unit!.siblings : []).find(
              (s) => s.id === tab.requestedVariantId
            ) ?? null)
          : null;
      return {
        unit,
        unitLabel: unit ? unitFullLabel(unit) : "Item",
        categoryLabel: unit ? categoryLabel(unit.kind) : "Item",
        reasonLabel:
          opts.reasons.find((r) => r.value === tab.reason)?.label ?? tab.reason,
        subReasonLabel:
          tab.reason && opts.subReasonsByReason[tab.reason as ExchangeReason]
            ? opts.subReasonsByReason[tab.reason as ExchangeReason]?.find(
                (s) => s.value === tab.subReason
              )?.label ?? null
            : null,
        damageLocationLabel:
          tab.reason && opts.damageLocationsByReason[tab.reason as ExchangeReason]
            ? opts.damageLocationsByReason[tab.reason as ExchangeReason]?.find(
                (d) => d.value === tab.damageLocation
              )?.label ?? null
            : null,
        replacementMode: tab.replacementMode,
        selectedSibling,
        replacementDescribe: tab.replacementDescribe,
        qty: unit ? effectiveQty(unit, tab) : 1,
        orderedQty: unit ? qtyCeiling(unit) : 1,
        notes: tab.notes,
      };
    });
    return (
      <ConfirmStep
        orderNumber={orderNumber}
        summaries={summaries}
        photos={photos}
        onBack={() => setStep("edit")}
        onSubmit={onSubmit}
        submitting={submitting}
        error={error}
      />
    );
  }

  // ── Render helpers: unit picker ───────────────────────────────
  // Single checkbox row — used for standalone items and for components
  // inside an expanded kit group. (The individual-item flow is unchanged.)
  const unitRow = (u: Unit, idx: number) => {
    const active = selectedIdxs.includes(idx);
    const locked = !!u.locked;
    const notDelivered = !!u.notDelivered;
    const disabled = locked || notDelivered;
    const toggle = () => {
      if (disabled) return;
      setSelectionConfirmed(false);
      setSelectedIdxs((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
      );
    };
    return (
      <li key={u.unitKey}>
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          className={
            "w-full text-left rounded-lg border px-3 py-2 text-[13px] flex items-center gap-2 " +
            (disabled
              ? "border-ink-200 bg-cream-50/60 text-ink-400 cursor-not-allowed"
              : active
              ? "border-brand bg-brand/5 text-ink-900"
              : "border-ink-200 hover:border-ink-400 text-ink-700")
          }
        >
          <span
            className={
              "h-3.5 w-3.5 rounded-sm border-2 shrink-0 flex items-center justify-center " +
              (disabled
                ? "border-ink-200 bg-ink-100"
                : active
                ? "border-brand bg-brand"
                : "border-ink-300")
            }
          >
            {active && !disabled && (
              <svg
                viewBox="0 0 12 12"
                className="h-2.5 w-2.5 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M2 6l2.5 2.5L10 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="flex-1 min-w-0">
            <span className="font-medium block truncate">{u.name}</span>
            <span className="text-[11.5px] text-ink-500 block truncate">
              {unitDetailLabel(u) || "—"}
              {u.isKitComponent && !kitGroups.has(u.orderItemId) && (
                <span className="text-ink-400"> · in {u.parentName}</span>
              )}
              {locked && (
                <span className="text-amber-700">
                  {" "}· Already in progress
                  {u.lockReturnNumber ? ` (${u.lockReturnNumber})` : ""}
                </span>
              )}
              {notDelivered && !locked && (
                <span className="text-amber-700">
                  {" "}· Pending delivery — Exchange request is not available yet
                </span>
              )}
            </span>
          </span>
          <span
            className={
              "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider " +
              (disabled
                ? "border-ink-200 bg-cream-50 text-ink-400"
                : active
                ? "border-brand/40 bg-white text-brand"
                : "border-ink-200 bg-cream-50 text-ink-500")
            }
          >
            {categoryLabel(u.kind)}
          </span>
        </button>
      </li>
    );
  };

  // Kit / Magic-Box card: one card for the whole family with a scope
  // chooser, expanding to the component checkboxes for partial exchange.
  const kitGroupCard = (orderItemId: string) => {
    const g = kitGroups.get(orderItemId);
    if (!g) return null;
    const parent = units[g.parentIdx];
    if (!parent) return null;
    // Whole-box exchange has been retired — a Magic Box can only ever be
    // exchanged item-by-item, so the scope is always "items" and the
    // chooser is gone. Kept as a constant so the existing selection/border
    // machinery below keeps working unchanged.
    const scope = "items" as const;
    // "locked" here means DISABLED — an active request already covers this box
    // (parent.locked), collapsing the card to a greyed, non-pickable state.
    const locked = !!parent.locked;
    const compCount = g.compIdxs.length;
    return (
      <li key={`kit:${orderItemId}`}>
        <div
          className={
            "rounded-xl border overflow-hidden " +
            (locked
              ? "border-ink-200 bg-cream-50/60"
              : scope
              ? "border-brand/50"
              : "border-ink-200")
          }
        >
          <div className="px-3 py-2.5 border-b border-ink-100 bg-cream-50/40 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-ink-900 truncate">
                {parent.name}
              </p>
              <p className="text-[11.5px] text-ink-500">
                {compCount} items inside
                {parent.locked && (
                  <span className="text-amber-700">
                    {" "}· Already in progress
                    {parent.lockReturnNumber ? ` (${parent.lockReturnNumber})` : ""}
                  </span>
                )}
                {parent.someComponentsLocked && !parent.locked && (
                  <span className="text-amber-700">
                    {" "}· Some items already in a request — pick from the rest
                  </span>
                )}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-500">
              {categoryLabel(parent.kind)}
            </span>
          </div>
          {!locked && (
            <div className="p-3 space-y-2">
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-500">
                Which items need exchanging?
              </p>
              <p className="-mt-1 text-[11.5px] text-ink-500">
                Pick the specific items inside this box that have a problem — the
                rest stays with you.
              </p>
              {(() => {
                const cats = categoriesFor(g.compIdxs);
                // Non-bookkit kits (no categories) → flat list, unchanged.
                if (cats.size === 0) {
                  return (
                    <ul className="space-y-1.5 pt-1">
                      {g.compIdxs.map((ci) => unitRow(units[ci], ci))}
                    </ul>
                  );
                }
                // Category accordion. Any components WITHOUT a category
                // (e.g. the uniform pieces in a hybrid magic box whose bookkit
                // drills down) render as flat rows above the accordions.
                const ungrouped = g.compIdxs.filter((ci) => !units[ci]?.categoryKey);

                // One category accordion (kit → category → book).
                const catLi = (catKey: string, cat: { name: string; idxs: number[] }) => {
                  // "Whole category" acts only on SELECTABLE books — a locked /
                  // not-yet-delivered book stays untouched so the category
                  // checkbox can't sneak an ineligible item into the request.
                  // The count still shows the full category size.
                  const selectable = cat.idxs.filter((i) => !isUnitDisabled(i));
                  const allSelected =
                    selectable.length > 0 && selectable.every((i) => selectedIdxs.includes(i));
                  const someSelected = selectable.some((i) => selectedIdxs.includes(i));
                  const open = openCategories[catKey] ?? someSelected;
                  const selCount = selectable.filter((i) => selectedIdxs.includes(i)).length;
                  return (
                    <li key={catKey} className="rounded-lg border border-ink-200 overflow-hidden">
                      <div className="flex items-center gap-2 px-2.5 py-2 bg-cream-50/50">
                        <button
                          type="button"
                          disabled={selectable.length === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCategorySelected(selectable, !allSelected);
                          }}
                          className={
                            "h-3.5 w-3.5 rounded-sm border-2 shrink-0 flex items-center justify-center " +
                            (allSelected
                              ? "border-brand bg-brand"
                              : someSelected
                              ? "border-brand bg-brand/30"
                              : "border-ink-300")
                          }
                          aria-label="Select whole category"
                        >
                          {allSelected && (
                            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M2 6l2.5 2.5L10 3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        <button type="button" onClick={() => toggleCategoryOpen(catKey)} className="flex-1 min-w-0 text-left">
                          <span className="block truncate text-[13px] font-medium text-ink-900">
                            {cat.name}
                          </span>
                          <span className="block text-[11px] text-ink-500">
                            {cat.idxs.length} item{cat.idxs.length === 1 ? "" : "s"}
                            {selCount > 0 ? ` · ${selCount} selected` : ""} · tap to {open ? "collapse" : "expand"}
                          </span>
                        </button>
                      </div>
                      {open && (
                        <ul className="space-y-1.5 p-2 border-t border-ink-100">
                          {cat.idxs.map((ci) => unitRow(units[ci], ci))}
                        </ul>
                      )}
                    </li>
                  );
                };

                // Split categories: those belonging to a bookkit NESTED in a
                // magic box get grouped under a bookkit header; a standalone
                // bookkit's categories (no bookkitName) render directly.
                const byBookkit = new Map<string, [string, { name: string; idxs: number[] }][]>();
                const loose: [string, { name: string; idxs: number[] }][] = [];
                for (const [catKey, cat] of cats) {
                  const bkName = units[cat.idxs[0]]?.bookkitName ?? null;
                  if (bkName) {
                    if (!byBookkit.has(bkName)) byBookkit.set(bkName, []);
                    byBookkit.get(bkName)!.push([catKey, cat]);
                  } else {
                    loose.push([catKey, cat]);
                  }
                }

                return (
                  <ul className="space-y-2 pt-1">
                    {ungrouped.map((ci) => unitRow(units[ci], ci))}
                    {loose.map(([catKey, cat]) => catLi(catKey, cat))}
                    {[...byBookkit].map(([bkName, entries]) => {
                      const bookCount = entries.reduce((n, [, c]) => n + c.idxs.length, 0);
                      return (
                        <li key={`bk:${bkName}`} className="rounded-xl border border-ink-200 overflow-hidden">
                          <div className="px-2.5 py-2 bg-cream-100/70 border-b border-ink-100">
                            <p className="text-[12.5px] font-semibold text-ink-900 truncate">{bkName}</p>
                            <p className="text-[10.5px] text-ink-500">
                              Bookkit · {bookCount} book{bookCount === 1 ? "" : "s"} in {entries.length} categor{entries.length === 1 ? "y" : "ies"} · tap a category to expand
                            </p>
                          </div>
                          <ul className="space-y-2 p-2">
                            {entries.map(([catKey, cat]) => catLi(catKey, cat))}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
          )}
        </div>
      </li>
    );
  };

  // ── Render: edit step ─────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5 lg:p-6 space-y-5">
      {qtyToast}
      {/* Order header */}
      <div className="flex items-center justify-between pb-4 border-b border-ink-100">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Order
          </p>
          <p className="font-medium text-ink-900 text-[14px]">#{orderNumber}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Items in this order
          </p>
          <p className="text-[13px] text-ink-700">{units.length}</p>
        </div>
      </div>

      {/* Unit picker — always shown when there are 2+ units. For a
          single-unit order we still display a read-only summary so the
          customer knows what they're filing. */}
      {!singleUnit ? (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-700">
            Which item(s) do you want to exchange?
          </p>
          <p className="mt-1 text-[11.5px] text-ink-500">
            Tick every item with a problem — you can select more than one.
          </p>
          <ul className="mt-2 space-y-2">
            {(() => {
              const seenKit = new Set<string>();
              const rows: React.ReactNode[] = [];
              units.forEach((u, idx) => {
                const grouped =
                  kitGroups.has(u.orderItemId) && (u.isKitParent || u.isKitComponent);
                if (grouped) {
                  if (!seenKit.has(u.orderItemId)) {
                    seenKit.add(u.orderItemId);
                    rows.push(kitGroupCard(u.orderItemId));
                  }
                  return;
                }
                // Whole-box exchange is retired: a kit parent is never
                // selectable on its own. If its components couldn't be
                // resolved (empty bundle_selections and no fallback tree) it
                // falls out of kitGroups — drop it rather than letting it
                // render as a "Whole box" row.
                if (u.isKitParent) return;
                rows.push(unitRow(u, idx));
              });
              return rows;
            })()}
          </ul>
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-ink-200 bg-cream-50/40 px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={selectionConfirmed}
              onChange={(e) => setSelectionConfirmed(e.target.checked)}
              disabled={selectedIdxs.length === 0}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand"
            />
            <span className="text-[12.5px] text-ink-700">
              I confirm the item(s) selected above are the ones I want to exchange.
              <span className="text-red-500">*</span>
            </span>
          </label>
        </div>
      ) : (
        <div className="rounded-lg border border-ink-200 bg-cream-50/40 p-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-700">
            Exchanging
          </p>
          <p className="mt-1 text-[13px] text-ink-800">{unitFullLabel(units[0])}</p>
        </div>
      )}

      {/* Per-unit tab strip */}
      {selectionConfirmed && tabKeys.length > 1 && (
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-500">
            Tell us about each item
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tabKeys.map((k) => {
              const idx = parseInt(k, 10);
              const u = units[idx];
              if (!u) return null;
              const isActive = k === activeTab;
              const tab = tabStates[k] ?? emptyTab();
              const err = validateTab(tab, u);
              const done = !err;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActiveTab(k)}
                  className={
                    "rounded-lg border px-3 py-1.5 text-[12.5px] inline-flex items-center gap-1.5 max-w-full " +
                    (isActive
                      ? "border-brand bg-brand/5 text-ink-900 font-medium"
                      : "border-ink-200 text-ink-700 hover:border-ink-400")
                  }
                >
                  <span className="truncate max-w-[180px]">{u.name}</span>
                  <span className="shrink-0 rounded-full border border-ink-200 bg-cream-50 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-ink-500">
                    {categoryLabel(u.kind)}
                  </span>
                  {done ? (
                    <span className="text-emerald-600 text-[12px]">✓</span>
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-tab body */}
      {selectionConfirmed && activeUnit && (
        <>
          {/* About this item */}
          <div className="rounded-lg border border-ink-200 bg-cream-50/40 p-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-700">
              About this item
            </p>
            <p className="mt-1 text-[13px] text-ink-800">{unitFullLabel(activeUnit)}</p>
            {activeUnit.isKitComponent && (
              <p className="mt-0.5 text-[11.5px] text-ink-500">
                Inside {activeUnit.parentName}
              </p>
            )}
          </div>

          {/* Quantity. Always shown — even on a × 1 line — so the ceiling
              ("of 1") is visible BEFORE the customer hits it. Every entry
              path clamps to that ceiling: the ± buttons, the typed value,
              blur, and once more when the payload is built. */}
          <div>
            <label
              htmlFor="exchange-qty"
              className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700"
            >
              How many need exchanging?
            </label>
            <p className="mt-1 text-[11.5px] text-ink-500">
              {activeCeiling > 1
                ? `You ordered ${activeCeiling} of this. Enter how many have the problem — the rest stay with you.`
                : `You ordered ${activeCeiling} of this, so this request covers ${activeCeiling}.`}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[12.5px] text-ink-500">Qty</span>
              <button
                type="button"
                onClick={() =>
                  setQty(Math.max(1, effectiveQty(activeUnit, cur) - 1))
                }
                className="h-9 w-9 rounded-lg border border-ink-200 text-[18px] text-ink-700 hover:border-ink-400 disabled:opacity-40"
                disabled={effectiveQty(activeUnit, cur) <= 1}
                aria-label="Decrease quantity"
              >
                −
              </button>
              <input
                id="exchange-qty"
                type="number"
                min={1}
                max={activeCeiling}
                value={cur.qtyText ?? String(effectiveQty(activeUnit, cur))}
                aria-label={`Quantity to exchange for ${activeUnit.name}, at most ${activeCeiling}`}
                // Select-on-focus (+ mouseup guard so the browser doesn't
                // collapse it to a caret) so click-then-type REPLACES the
                // number rather than appending to it.
                onFocus={(e) => e.target.select()}
                onMouseUp={(e) => e.preventDefault()}
                onChange={(e) => applyQtyInput(e.target, activeUnit, "change")}
                onBlur={(e) => applyQtyInput(e.target, activeUnit, "blur")}
                className="w-16 rounded-lg border border-ink-200 bg-white px-3 py-2 text-[14px] text-center"
              />
              <button
                type="button"
                onClick={() =>
                  setQty(
                    Math.min(activeCeiling, effectiveQty(activeUnit, cur) + 1)
                  )
                }
                className="h-9 w-9 rounded-lg border border-ink-200 text-[18px] text-ink-700 hover:border-ink-400 disabled:opacity-40"
                disabled={effectiveQty(activeUnit, cur) >= activeCeiling}
                aria-label="Increase quantity"
              >
                +
              </button>
              <span className="text-[12.5px] text-ink-500">
                of {activeCeiling}
              </span>
            </div>
          </div>

          {/* Current size — only for box components whose ordered size
              wasn't recorded. We ask so the swap is unambiguous. */}
          {activeUnit.currentUnknown && (
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
                Which size do you currently have?
              </label>
              <p className="mt-1 text-[11.5px] text-ink-500">
                This item was part of a Magic Box, so we don&apos;t have its
                exact size on file — please pick the one you received.
              </p>
              <select
                value={currentVariantId}
                onChange={(e) => setCurrentVariantId(e.target.value)}
                className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[14px]"
              >
                <option value="">Select your current size…</option>
                {(Array.isArray(activeUnit.siblings) ? activeUnit.siblings : []).map(
                  (s) => (
                    <option key={s.id} value={s.id}>
                      {siblingDropdownLabel(s)}
                    </option>
                  )
                )}
              </select>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
              Reason
            </label>
            <select
              value={reason}
              onChange={(e) => {
                const v = e.target.value as ExchangeReason | "";
                setReason(v);
                setSubReason("");
                setDamageLocation("");
                setRequestedVariantId("");
                setWrongItemFault("");
              }}
              className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[14px]"
            >
              <option value="">Select a reason…</option>
              {reasonOpts.reasons.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Wrong-item fault */}
          {reason === "wrong_item" && (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-700">
                Before we continue
              </p>
              <p className="mt-1 text-[12px] text-ink-600">
                Did we send you the wrong item, or did you realise after delivery that you
                ordered the wrong thing?
              </p>
              <div className="mt-2 space-y-2">
                <ReplacementOption
                  checked={wrongItemFault === "fulfillment"}
                  onSelect={() => setWrongItemFault("fulfillment")}
                  title="You sent me the wrong item"
                  hint="The order shows the right thing, but I received something else. Exchange is the right path."
                />
                <ReplacementOption
                  checked={wrongItemFault === "customer"}
                  onSelect={() => setWrongItemFault("customer")}
                  title="I ordered the wrong thing"
                  hint="I picked the wrong item at checkout — your fulfilment was correct."
                />
              </div>
            </div>
          )}

          {/* Sub-reason */}
          {subReasonChoices.length > 0 &&
            (reason !== "wrong_item" || wrongItemFault === "fulfillment") && (
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
                Be more specific
              </label>
              <select
                value={subReason}
                onChange={(e) => setSubReason(e.target.value)}
                className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[14px]"
              >
                <option value="">Select…</option>
                {subReasonChoices.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Damage location */}
          {needsDamageLocation && (
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
                Where on the item?
              </label>
              <select
                value={damageLocation}
                onChange={(e) => setDamageLocation(e.target.value)}
                className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[14px]"
              >
                <option value="">Select…</option>
                {damageLocationChoices.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Replacement picker */}
          {reason && (reason !== "wrong_item" || wrongItemFault !== "") && anyReplacementOption && (
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
                What would you like instead?
              </label>
              <p className="mt-1 text-[11.5px] text-ink-500">
                You choose — we won&apos;t assume.
              </p>
              <div className="mt-2 space-y-2">
                {reason !== "wrong_item" && reason !== "other" && reason !== "wrong_size_delivered" && (
                  <ReplacementOption
                    checked={replacementMode === "same_fresh"}
                    onSelect={() =>
                      setReplacementMode((m) => (m === "same_fresh" ? "" : "same_fresh"))
                    }
                    title="Same item, fresh piece"
                    hint="We'll send a fresh copy of the same variant."
                  />
                )}
                {siblingAvailable && (
                  <ReplacementOption
                    checked={replacementMode === "sibling"}
                    onSelect={() =>
                      setReplacementMode((m) => (m === "sibling" ? "" : "sibling"))
                    }
                    title={
                      reason === "wrong_item"
                        ? "The size / variant I actually wanted"
                        : "Different size / variant of the same product"
                    }
                    hint="Pick exactly what you want from the available sizes / variants below."
                  >
                    {replacementMode === "sibling" && activeUnit && (
                      <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                        {/* Colour / Size axis pickers (reason-driven). Falls
                            back to the full variant dropdown when the product's
                            axes can't be split cleanly. */}
                        {(showColorPicker || showSizePicker) ? (
                          <div className="flex flex-wrap gap-2">
                            {showColorPicker && (
                              <label className="flex-1 min-w-[140px]">
                                <span className="block text-[11px] font-semibold text-ink-600">
                                  Required colour
                                  {variantAxes.origColor ? ` (ordered: ${variantAxes.origColor})` : ""}
                                </span>
                                <select
                                  value={requestedColor}
                                  onChange={(e) => chooseColor(e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13.5px]"
                                >
                                  <option value="">Keep {variantAxes.origColor || "same"}</option>
                                  {variantAxes.colors.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                            {showSizePicker && (
                              <label className="flex-1 min-w-[140px]">
                                <span className="block text-[11px] font-semibold text-ink-600">
                                  Required size
                                  {variantAxes.origSize ? ` (ordered: ${variantAxes.origSize})` : ""}
                                </span>
                                <select
                                  value={requestedSize}
                                  onChange={(e) => chooseSize(e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13.5px]"
                                >
                                  <option value="">Keep {variantAxes.origSize || "same"}</option>
                                  {variantAxes.sizes.map((sz) => (
                                    <option key={sz} value={sz}>{sz}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </div>
                        ) : (
                          <select
                            value={requestedVariantId}
                            onChange={(e) => setRequestedVariantId(e.target.value)}
                            className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13.5px]"
                          >
                            <option value="">Select…</option>
                            {(Array.isArray(activeUnit.siblings) ? activeUnit.siblings : []).map((s) => (
                              <option key={s.id} value={s.id} disabled={!s.isActive}>
                                {siblingDropdownLabel(s)}
                                {!s.isActive ? " (not available)" : ""}
                              </option>
                            ))}
                          </select>
                        )}
                        {(showColorPicker || showSizePicker) && requestedVariantId === "" && (requestedColor || requestedSize) && (
                          <p className="text-[11px] text-rose-600">
                            That colour/size combination isn&apos;t available — pick another.
                          </p>
                        )}
                      </div>
                    )}
                  </ReplacementOption>
                )}
              </div>
            </div>
          )}

          {/* Notes — only the mandatory describe box for the "Other" reason.
              The optional free-text notes box was removed by request. */}
          {reason === "other" && (
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
                Describe the issue
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Tell us what went wrong so we can help."
                className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[14px] leading-relaxed resize-none"
              />
            </div>
          )}
        </>
      )}

      {/* Photos */}
      {selectionConfirmed && (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-700">
            Photos · {photos.length} added
          </p>
          <p className="mt-1 text-[11.5px] text-ink-500">
            Clear photos in good lighting help us approve faster. Add as many as
            you like to each section (JPEG, PNG, WebP or HEIC, up to 50 MB each).
          </p>

          {photos.length > 0 && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {photos.map((p, i) => (
                <div
                  key={`${p.file.name}-${i}`}
                  className="relative aspect-square rounded-lg border border-ink-100 bg-cream-50 overflow-hidden"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.previewUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    onLoad={() => URL.revokeObjectURL(p.previewUrl)}
                  />
                  <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-black/50 text-white text-[10px] truncate">
                    {PHOTO_CATEGORIES.find((c) => c.value === p.category)?.label ?? p.category}
                  </div>
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 h-6 w-6 grid place-items-center rounded-full bg-white/90 border border-ink-200 hover:bg-white"
                    aria-label="Remove photo"
                  >
                    <X className="h-3.5 w-3.5 text-ink-700" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Always shown — sections accept unlimited photos. */}
          <div className="mt-3 space-y-1.5">
              {PHOTO_CATEGORIES.map((c) => {
                const have = photos.filter((p) => p.category === c.value).length;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => {
                      setStaging(c.value);
                      fileInputRef.current?.click();
                    }}
                    className="w-full text-left rounded-lg border border-dashed border-ink-200 px-3 py-2 hover:border-brand hover:bg-cream-50 flex items-center gap-3"
                  >
                    <Upload className="h-4 w-4 text-ink-500 flex-none" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink-900">
                        {c.label}
                        {have > 0 && (
                          <span className="ml-2 text-[11px] text-emerald-700">· {have} added</span>
                        )}
                      </p>
                      <p className="text-[11px] text-ink-500 truncate">{c.hint}</p>
                    </div>
                  </button>
                );
              })}
            </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={[...ALLOWED, ...ALLOWED_EXT].join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              const input = e.currentTarget;
              // Reset after staging so re-picking the same photo still fires
              // `change` (the bytes are already copied by then).
              void stageFiles(staging || "other", input.files).finally(() => {
                input.value = "";
              });
            }}
          />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={moveToConfirm}
        disabled={!selectionConfirmed}
        className="w-full rounded-xl bg-brand py-3 font-display font-bold text-white text-[14px] hover:opacity-90 disabled:bg-ink-200 disabled:cursor-not-allowed"
      >
        Review request
      </button>
    </div>
  );
}

type SummaryRow = {
  unit: Unit | undefined;
  unitLabel: string;
  categoryLabel: string;
  reasonLabel: string;
  subReasonLabel: string | null;
  damageLocationLabel: string | null;
  replacementMode: ReplacementMode | "";
  selectedSibling: SiblingLite | null;
  replacementDescribe: string;
  qty: number;
  orderedQty: number;
  notes: string;
};

function ConfirmStep({
  orderNumber,
  summaries,
  photos,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  orderNumber: string;
  summaries: SummaryRow[];
  photos: StagedPhoto[];
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const multi = summaries.length > 1;
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5 lg:p-6 space-y-5">
      <div className="flex items-center gap-2 text-ink-600">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <p className="text-[13px] font-medium">
          {multi ? `Review your ${summaries.length} requests` : "Review your request"}
        </p>
      </div>

      <div className="rounded-xl border border-ink-100 p-3 text-[13px]">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">
          Order
        </p>
        <p className="mt-1 font-medium text-ink-900">#{orderNumber}</p>
      </div>

      {multi && (
        <div className="rounded-lg border border-ink-200 bg-cream-50/40 p-3 text-[12.5px] text-ink-700">
          You&apos;re submitting <span className="font-semibold">{summaries.length} exchange requests</span> —
          one per item. Customer care will review each separately.
        </div>
      )}

      {summaries.map((s, i) => (
        <div
          key={s.unit?.unitKey ?? i}
          className="rounded-xl border border-brand/30 bg-brand/5 p-3 space-y-2"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-brand">
              {multi ? `${i + 1} of ${summaries.length} · ${s.categoryLabel}` : "You'll receive"}
            </p>
          </div>

          <p className="font-medium text-ink-900 text-[14px]">
            {s.unitLabel}
            {s.orderedQty > 1 && (
              <span className="ml-1 text-[12px] font-semibold text-brand">
                × {s.qty} of {s.orderedQty}
              </span>
            )}
          </p>
          {s.unit?.isKitComponent && (
            <p className="text-[11.5px] text-ink-500">Inside {s.unit.parentName}</p>
          )}

          {s.replacementMode === "sibling" && s.selectedSibling ? (
            <p className="text-[12.5px] text-ink-700">
              Replacement: <span className="font-medium">{siblingDropdownLabel(s.selectedSibling)}</span>
            </p>
          ) : s.replacementMode === "same_fresh" ? (
            <p className="text-[13px] text-ink-800">
              <span className="font-medium">Same item, fresh piece</span>
            </p>
          ) : s.replacementMode === "different_describe" ? (
            <p className="text-[12.5px] text-ink-700 whitespace-pre-line">
              Wants: {s.replacementDescribe || "(see notes)"}
            </p>
          ) : null}

          <div className="pt-1 text-[12.5px] space-y-1">
            <Row label="Reason" value={s.reasonLabel} />
            {s.subReasonLabel && <Row label="Detail" value={s.subReasonLabel} />}
            {s.damageLocationLabel && (
              <Row label="Location" value={s.damageLocationLabel} />
            )}
            {s.notes && <Row label="Notes" value={s.notes} wrap />}
          </div>
        </div>
      ))}

      <div className="text-[13px] space-y-1.5">
        <Row label="Photos" value={`${photos.length} attached`} />
      </div>

      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-[12.5px] text-emerald-900">
        Once approved, the exchange will be sent to your school. The school
        will inform you once it has been received there, and you can collect it
        then.
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-none inline-flex items-center justify-center gap-1.5 rounded-xl border border-ink-200 px-4 py-3 text-[14px] font-medium text-ink-700 hover:border-ink-400 disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="flex-1 rounded-xl bg-brand py-3 font-display font-bold text-white text-[14px] hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting
            ? "Submitting…"
            : multi
              ? `Submit ${summaries.length} requests`
              : "Submit request"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, wrap }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className={"flex " + (wrap ? "flex-col gap-0.5" : "items-baseline gap-3")}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 shrink-0">
        {label}
      </p>
      <p className={"text-ink-800 " + (wrap ? "whitespace-pre-line" : "flex-1 text-right")}>
        {value}
      </p>
    </div>
  );
}

function ReplacementOption({
  checked,
  onSelect,
  title,
  hint,
  children,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      onClick={disabled ? undefined : onSelect}
      aria-disabled={disabled}
      className={
        "rounded-lg border px-3 py-2.5 " +
        (disabled
          ? "border-ink-200 bg-cream-50/60 opacity-60 cursor-not-allowed "
          : "cursor-pointer ") +
        (checked && !disabled
          ? "border-brand bg-brand/5"
          : "border-ink-200 hover:border-ink-400 bg-white")
      }
    >
      <div className="flex items-start gap-2">
        <span
          className={
            "mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 " +
            (checked && !disabled ? "border-brand bg-brand" : "border-ink-300")
          }
        />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-ink-900">{title}</p>
          <p className="text-[11.5px] text-ink-500 mt-0.5">{hint}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
