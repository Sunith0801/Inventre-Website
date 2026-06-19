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
  // True when an earlier exchange for this order_item is still active
  // (status ∈ {requested, approved}). The picker disables it and shows
  // the existing RTN number so the customer doesn't try to re-submit.
  locked?: boolean;
  lockReturnNumber?: string | null;
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
  replacementDescribe: string;
  notes: string;
};

const emptyTab = (): TabState => ({
  reason: "",
  subReason: "",
  damageLocation: "",
  wrongItemFault: "",
  replacementMode: "",
  requestedVariantId: "",
  replacementDescribe: "",
  notes: "",
});

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
  const replacementDescribe = cur.replacementDescribe;
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
  const setReplacementDescribe = (v: string) => updateActive({ replacementDescribe: v });
  const setNotes = (v: string) => updateActive({ notes: v });

  const [staging, setStaging] = useState<string>("");
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const [kitScope, setKitScope] = useState<Record<string, "" | "full" | "items">>({});

  const setKitScopeFor = (orderItemId: string, scope: "full" | "items") => {
    const g = kitGroups.get(orderItemId);
    if (!g) return;
    setSelectionConfirmed(false);
    setKitScope((prev) => ({ ...prev, [orderItemId]: scope }));
    setSelectedIdxs((prev) => {
      const drop = new Set([g.parentIdx, ...g.compIdxs]);
      const next = prev.filter((i) => !drop.has(i));
      if (scope === "full") next.push(g.parentIdx);
      return next;
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

  const reasonOpts = useMemo(() => {
    if (!activeUnit) return getReasonOptions("other", false);
    return getReasonOptions(activeUnit.kind, activeUnit.hasSiblings);
  }, [activeUnit]);

  const subReasonChoices = reason ? (reasonOpts.subReasonsByReason[reason] ?? []) : [];
  const damageLocationChoices = reason
    ? (reasonOpts.damageLocationsByReason[reason] ?? [])
    : [];
  const needsDamageLocation = damageLocationChoices.length > 0;

  // Sibling picker shows up when the chosen reason calls for it AND
  // the active unit actually has siblings on its own product.
  const siblingAvailable =
    reasonOpts.showSiblingPicker &&
    (Array.isArray(activeUnit?.siblings) ? activeUnit!.siblings.length : 0) > 0;

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
  const stageFiles = (category: string, files: FileList | null) => {
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
      incoming.push({ file: f, category, previewUrl: URL.createObjectURL(f) });
    }
    // No count cap — each section accepts unlimited photos.
    setPhotos((prev) => [...prev, ...incoming]);
  };

  const removePhoto = (idx: number) => {
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

    if (!tab.reason) return "Please select a reason.";
    if (tab.reason === "wrong_item" && !tab.wrongItemFault) {
      return "Please tell us whether we sent the wrong item or you ordered the wrong one.";
    }
    if (tab.reason === "wrong_item" && tab.wrongItemFault === "customer") {
      return "Exchange isn't the right path here. Please contact customer care.";
    }
    if (subChoices.length > 0 && !tab.subReason) return "Please pick a sub-reason.";
    if (dmgChoices.length > 0 && !tab.damageLocation) {
      return "Please indicate where on the item the issue is.";
    }
    if (!tab.replacementMode) return "Please pick what you'd like instead.";
    if (tab.replacementMode === "sibling" && !tab.requestedVariantId) {
      return "Please pick the size / variant you'd like instead.";
    }
    if (tab.replacementMode === "different_describe" && !tab.replacementDescribe.trim()) {
      return "Please describe what you'd like instead.";
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
      for (const p of photos) {
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
        const upRes = await fetch(`/api/returns/upload?orderId=${orderId}`, {
          method: "POST",
          body: form,
        });
        if (!upRes.ok) {
          const j = await upRes.json().catch(() => ({}));
          // nginx rejects an over-limit body with 413 before the route runs,
          // so there's no JSON — surface a clear message in that case.
          const msg =
            j.error ??
            (upRes.status === 413
              ? "A photo was too large to upload. Please use photos under 50 MB."
              : `Upload failed (${upRes.status})`);
          throw new Error(msg);
        }
        const j = (await upRes.json()) as {
          photos: { url: string; key: string }[];
        };
        uploaded.push(...j.photos);
      }
      const taggedPhotos = uploaded.map((p, i) => ({
        url: p.url,
        key: p.key,
        category: photos[i]?.category ?? "other",
      }));

      // Flatten every tab into one perItem[]. One POST = one RTN bundle,
      // even when the customer flagged many components on the same order_item.
      const perItem: Record<string, unknown>[] = [];
      const composedNotesParts: string[] = [];
      for (const key of tabKeys) {
        const idx = parseInt(key, 10);
        const unit = units[idx];
        if (!unit) continue;
        const tab = tabStates[key] ?? emptyTab();

        const describeLabel =
          tab.reason === "wrong_item" ? "What I actually ordered" : "What I'd like instead";
        const tabNoteLines: string[] = [];
        if (tab.notes.trim()) tabNoteLines.push(tab.notes.trim());
        if (
          tab.replacementMode === "different_describe" &&
          tab.replacementDescribe.trim()
        ) {
          tabNoteLines.push(`${describeLabel}: ${tab.replacementDescribe.trim()}`);
        }
        const tabNotes = tabNoteLines.join("\n");
        if (tabNotes) composedNotesParts.push(`${unit.name}: ${tabNotes}`);

        const item: Record<string, unknown> = {
          orderItemId: unit.orderItemId,
          qty: unit.qty,
          reason: tab.reason,
        };
        if (tab.subReason) item.subReason = tab.subReason;
        if (tab.damageLocation) item.damageLocation = tab.damageLocation;
        if (tab.replacementMode) item.replacementMode = tab.replacementMode;
        if (tab.replacementMode === "sibling" && tab.requestedVariantId) {
          item.requestedVariantId = tab.requestedVariantId;
        }
        if (tabNotes) item.notes = tabNotes;
        if (unit.isKitComponent) {
          const path: Record<string, unknown> = {
            variantId: unit.variantId,
            componentName: unit.name,
            attributes: unit.attributes,
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

      const res = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Submit failed (${res.status})`);
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/shop/orders/${orderId}/exchange/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
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
    const toggle = () => {
      if (locked) return;
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
          disabled={locked}
          className={
            "w-full text-left rounded-lg border px-3 py-2 text-[13px] flex items-center gap-2 " +
            (locked
              ? "border-ink-200 bg-cream-50/60 text-ink-400 cursor-not-allowed"
              : active
              ? "border-brand bg-brand/5 text-ink-900"
              : "border-ink-200 hover:border-ink-400 text-ink-700")
          }
        >
          <span
            className={
              "h-3.5 w-3.5 rounded-sm border-2 shrink-0 flex items-center justify-center " +
              (locked
                ? "border-ink-200 bg-ink-100"
                : active
                ? "border-brand bg-brand"
                : "border-ink-300")
            }
          >
            {active && !locked && (
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
            </span>
          </span>
          <span
            className={
              "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider " +
              (locked
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
    const scope = kitScope[orderItemId] ?? "";
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
                {locked && (
                  <span className="text-amber-700">
                    {" "}· Already in progress
                    {parent.lockReturnNumber ? ` (${parent.lockReturnNumber})` : ""}
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
                What needs exchanging?
              </p>
              <ReplacementOption
                checked={scope === "full"}
                onSelect={() => setKitScopeFor(orderItemId, "full")}
                title="The whole box"
                hint="Everything goes back and you receive a complete replacement."
              />
              <ReplacementOption
                checked={scope === "items"}
                onSelect={() => setKitScopeFor(orderItemId, "items")}
                title="Only some items inside"
                hint="Pick the specific items that have a problem — the rest stays with you."
              />
              {scope === "full" && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12px] text-emerald-900">
                  Whole box selected — all {compCount} items will be exchanged together.
                </div>
              )}
              {scope === "items" && (
                <ul className="space-y-1.5 pt-1">
                  {g.compIdxs.map((ci) => unitRow(units[ci], ci))}
                </ul>
              )}
            </div>
          )}
        </div>
      </li>
    );
  };

  // ── Render: edit step ─────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5 lg:p-6 space-y-5">
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
                    {u.isKitParent ? "Whole box" : categoryLabel(u.kind)}
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
            {activeUnit.isKitParent && (
              <p className="mt-0.5 text-[11.5px] text-ink-500">
                Whole box — every item inside will be exchanged together.
              </p>
            )}
          </div>

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
              {wrongItemFault === "customer" && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
                  <p className="font-semibold">Exchange can&apos;t help with this.</p>
                  <p className="mt-1">
                    Exchange covers items we shipped incorrectly. For a checkout mistake,
                    please contact customer care.
                  </p>
                  <a
                    href="/support"
                    className="mt-2 inline-block text-amber-900 underline font-semibold"
                  >
                    Contact customer care →
                  </a>
                </div>
              )}
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
          {reason && (reason !== "wrong_item" || wrongItemFault === "fulfillment") && (
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
                    title={
                      activeUnit?.isKitParent
                        ? "A fresh replacement box"
                        : "Same item, fresh piece"
                    }
                    hint={
                      activeUnit?.isKitParent
                        ? "We'll send a complete fresh box with everything inside."
                        : "We'll send a fresh copy of the same variant."
                    }
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
                      <select
                        value={requestedVariantId}
                        onChange={(e) => setRequestedVariantId(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13.5px]"
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
                  </ReplacementOption>
                )}
                {reason !== "damaged" && (
                  <ReplacementOption
                    checked={replacementMode === "different_describe"}
                    onSelect={() =>
                      setReplacementMode((m) =>
                        m === "different_describe" ? "" : "different_describe"
                      )
                    }
                    title="Something different — let me describe it"
                    hint={
                      reason === "wrong_item"
                        ? "Tell us what you actually ordered."
                        : "Tell us what would make this right."
                    }
                  >
                    {replacementMode === "different_describe" && (
                      <input
                        type="text"
                        value={replacementDescribe}
                        onChange={(e) => setReplacementDescribe(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        maxLength={200}
                        placeholder={
                          reason === "wrong_item"
                            ? "e.g. SMS Boys Pants size M, not Belt"
                            : "e.g. Replace with size M instead"
                        }
                        className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13.5px]"
                      />
                    )}
                  </ReplacementOption>
                )}
              </div>
              {!siblingAvailable && reasonOpts.showSiblingPicker && (
                <p className="mt-2 text-[11.5px] text-ink-500">
                  No other sizes / variants are listed for this product. If you want one,
                  choose &quot;describe&quot; above and we&apos;ll follow up.
                </p>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
              {reason === "other" ? "Describe the issue" : "Additional notes (optional)"}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={
                reason === "other"
                  ? "Tell us what went wrong so we can help."
                  : "e.g. The stitching at the collar has come undone."
              }
              className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[14px] leading-relaxed resize-none"
            />
          </div>
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
            onChange={(e) => stageFiles(staging || "other", e.target.files)}
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

          <p className="font-medium text-ink-900 text-[14px]">{s.unitLabel}</p>
          {s.unit?.isKitComponent && (
            <p className="text-[11.5px] text-ink-500">Inside {s.unit.parentName}</p>
          )}
          {s.unit?.isKitParent && (
            <p className="text-[11.5px] text-ink-500">
              Whole box — all items inside are exchanged together.
            </p>
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
        Once approved, please visit your school on the upcoming Saturday (at least 7 days
        from today) to collect. We&apos;ll text you the exact date.
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
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      onClick={onSelect}
      className={
        "rounded-lg border px-3 py-2.5 cursor-pointer " +
        (checked
          ? "border-brand bg-brand/5"
          : "border-ink-200 hover:border-ink-400 bg-white")
      }
    >
      <div className="flex items-start gap-2">
        <span
          className={
            "mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 " +
            (checked ? "border-brand bg-brand" : "border-ink-300")
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
