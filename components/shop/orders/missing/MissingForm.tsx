"use client";

/**
 * Missing-item claim form.
 *
 * Order-level flow: the page hands us a flat `units` list covering
 * every exchangeable thing in the order. The customer ticks every unit
 * that never arrived and types a per-unit qty short. Submit fires ONE
 * /api/missing call with all ticked units bundled into a single claim
 * (one MIS-YYYY-NNNNN id covers the whole short shipment).
 */

import { useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, AlertCircle, Loader2, Phone } from "lucide-react";
import {
  clampRequestedQty,
  exceedsQtyCeiling,
  qtyCapMessage,
} from "@/lib/return-qty";
import { useQtyCapToast } from "@/components/shop/orders/QtyCapToast";
import { fetchOrNetworkError, errorMessageFor } from "@/lib/client-fetch";
import { snapshotPhoto } from "@/lib/photo-snapshot";

type Unit = {
  unitKey: string;
  orderItemId: string;
  parentName: string;
  isKitComponent: boolean;
  /** The kit/Magic-Box order item itself — selecting it = whole box missing. */
  isKitParent?: boolean;
  name: string;
  size: string;
  qty: number;
  variantId: string;
  kind: string;
  attributes: { name: string; value: string }[];
  /** Bookkit drill-down: the category (sub_bundle) this leaf book sits under.
   *  Present only on bookkit component units. */
  categoryKey?: string | null;
  categoryName?: string | null;
  /** Nested-bookkit key+name (magic box only) — nests categories under a
   *  bookkit header. Absent on standalone bookkit + uniforms. */
  bookkitKey?: string | null;
  bookkitName?: string | null;
  // Item-wise: locked = already in a non-rejected exchange/missing request →
  // renders greyed / disabled.
  locked?: boolean;
  lockReturnNumber?: string | null;
  // Kit-parent only: some (not all) components already in a request → box stays
  // open for the rest; drives the explanatory note on the kit card.
  // (Whole-box missing itself is retired — see kitGroupCard.)
  someComponentsLocked?: boolean;
  // Bookkit book whose parcel hasn't arrived — greyed "not delivered yet".
  notDelivered?: boolean;
  // Kit-parent only: some components not delivered yet.
  someComponentsUndelivered?: boolean;
  /** Outstanding quantity when an earlier, non-rejected request already covers
   *  part of a multi-qty line. Absent = the ceiling is the full ordered `qty`.
   *  (The per-component lock currently removes such a line entirely, so the
   *  page doesn't set this yet; the picker honours it as soon as it does.) */
  remainingQty?: number | null;
  /** The RTN-/MIS- number covering the rest, named in the cap toast. */
  remainingCoveredByRef?: string | null;
};

/** Ceiling for a line's "how many were missing" box: the outstanding
 *  remainder when known, else the ordered quantity. Never below 1. */
function qtyCeiling(u: Unit | undefined): number {
  if (!u) return 1;
  const remaining =
    typeof u.remainingQty === "number" && u.remainingQty > 0
      ? u.remainingQty
      : null;
  return Math.max(1, Math.floor(remaining ?? u.qty ?? 1));
}

type StagedPhoto = {
  file: File;
  category: string;
  previewUrl: string;
};

const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

// CC contact info shown on submit — placeholder, swap for the real
// number when ops confirms.
const CC_PHONE = "+91 9999912345";

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
  if (u.qty > 1) parts.push(`ordered × ${u.qty}`);
  return parts.join(" · ");
}

export function MissingForm({
  orderId,
  orderNumber,
  units,
}: {
  orderId: string;
  orderNumber: string;
  units: Unit[];
}) {
  const router = useRouter();

  const singleUnit = units.length === 1;

  const [selectedIdxs, setSelectedIdxs] = useState<number[]>(
    singleUnit ? [0] : []
  );
  const [selectionConfirmed, setSelectionConfirmed] = useState<boolean>(singleUnit);
  // Per-unit qtyShort, keyed by unit index. Defaults to the unit's full
  // ordered qty (most missing claims are "all of them didn't arrive").
  const [qtyShortByIdx, setQtyShortByIdx] = useState<Record<number, number>>({});
  // What's literally in the box, per unit index. Kept alongside the numeric
  // state so a half-typed or momentarily EMPTY box stays on screen — a purely
  // numeric controlled input would stamp "1" back the instant the customer
  // cleared it, and their next digit would land as "1X".
  const [qtyTextByIdx, setQtyTextByIdx] = useState<Record<number, string>>({});
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Explains a quantity clamp ("Only 1 of \"SMS Caps\" was ordered.").
  const { toast: qtyToast, showQtyCapToast } = useQtyCapToast();

  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Photos already staged by an attempt whose create call then failed, so a
   *  retry skips straight to create instead of re-uploading. */
  const uploadedPhotosRef = useRef<
    { url: string; key: string; category: string }[] | null
  >(null);

  // Clamped on read as well as on write: state seeded before a unit list
  // changed (or tampered with) can never survive into the payload.
  const qtyFor = (idx: number): number => {
    const ceiling = qtyCeiling(units[idx]);
    const v = qtyShortByIdx[idx];
    if (typeof v === "number") return clampRequestedQty(v, ceiling);
    return ceiling;
  };

  const setQtyFor = (idx: number, value: number) => {
    const clamped = clampRequestedQty(value, qtyCeiling(units[idx]));
    setQtyShortByIdx((prev) => ({ ...prev, [idx]: clamped }));
    setQtyTextByIdx((prev) => ({ ...prev, [idx]: String(clamped) }));
  };

  /** What the box shows: the raw text while typing, else the numeric value. */
  const qtyTextFor = (idx: number): string =>
    qtyTextByIdx[idx] ?? String(qtyFor(idx));

  /**
   * Single entry point for a typed / pasted / blurred quantity.
   *
   * `max=` on the input is advisory — browsers accept a typed 5 in a max=1
   * box, which is how a claim for 2 of a × 1 component got raised. On top of
   * clamping, note the forced `el.value` write: React skips re-writing
   * `value` when the clamped number equals the state it already holds, so the
   * typed "5" would otherwise stay on screen while state said 1. Writing the
   * node directly keeps caret/focus, unlike a remount.
   */
  const applyQtyInput = (
    el: HTMLInputElement,
    idx: number,
    phase: "change" | "blur",
  ) => {
    const u = units[idx];
    const ceiling = qtyCeiling(u);
    const raw = el.value;
    const over = !!u && exceedsQtyCeiling(raw, ceiling);
    const clamped = clampRequestedQty(raw, ceiling);

    if (over) {
      showQtyCapToast(
        qtyCapMessage(u!.name, ceiling, u!.remainingCoveredByRef ?? null),
      );
    }
    // Leave a mid-edit value (empty, "0") alone until blur; only an
    // over-the-cap value is corrected on the spot, because that's the one the
    // customer needs told about.
    const shouldRewrite = over || phase === "blur";
    if (shouldRewrite && el.value !== String(clamped)) el.value = String(clamped);

    setQtyShortByIdx((prev) => ({ ...prev, [idx]: clamped }));
    setQtyTextByIdx((prev) => ({
      ...prev,
      [idx]: shouldRewrite ? String(clamped) : raw,
    }));
  };

  const totalSelected = useMemo(() => selectedIdxs.length, [selectedIdxs]);

  // ── Kit / Magic Box grouping (mirrors the exchange form) ──────
  // A kit order item arrives as one "parent" unit (whole box missing)
  // plus one unit per component. The picker collapses each family into
  // a single card with a scope chooser.
  const kitGroups = useMemo(() => {
    const map = new Map<string, { parentIdx: number; compIdxs: number[] }>();
    units.forEach((u, idx) => {
      if (!u.isKitParent && !u.isKitComponent) return;
      const g = map.get(u.orderItemId) ?? { parentIdx: -1, compIdxs: [] };
      if (u.isKitParent) g.parentIdx = idx;
      else g.compIdxs.push(idx);
      map.set(u.orderItemId, g);
    });
    return new Map(
      [...map].filter(([, g]) => g.parentIdx >= 0 && g.compIdxs.length > 0)
    );
  }, [units]);

  // ── Bookkit category grouping (mirrors the exchange form) ──────
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

  // ── Photo handling ────────────────────────────────────────────
  const stageFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const incoming: StagedPhoto[] = [];
    for (const f of Array.from(files)) {
      if (!ALLOWED.includes(f.type)) {
        setError(`"${f.name}" must be JPEG, PNG, or WebP.`);
        return;
      }
      if (f.size > MAX_BYTES) {
        setError(`"${f.name}" exceeds 8 MB.`);
        return;
      }
      // Copy the bytes NOW — see lib/photo-snapshot.ts. Keeping the OS file
      // handle until Submit is what made uploads die as "Failed to fetch"
      // with nothing ever reaching the server.
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
        category: "what_arrived",
        previewUrl: URL.createObjectURL(snapshot),
      });
    }
    uploadedPhotosRef.current = null; // the staged set is now stale
    setPhotos((prev) => {
      const next = [...prev, ...incoming];
      if (next.length > MAX_FILES) {
        setError(`At most ${MAX_FILES} photos.`);
        return next.slice(0, MAX_FILES);
      }
      return next;
    });
  };

  const removePhoto = (idx: number) => {
    uploadedPhotosRef.current = null; // the staged set is now stale
    setPhotos((p) => p.filter((_, i) => i !== idx));
  };

  // ── Validation ───────────────────────────────────────────────
  const validate = (): string | null => {
    if (selectedIdxs.length === 0) return "Please pick at least one missing item.";
    if (!selectionConfirmed) return "Please confirm the items you selected are correct.";
    for (const idx of selectedIdxs) {
      const u = units[idx];
      if (!u) continue;
      const q = qtyFor(idx);
      const ceiling = qtyCeiling(u);
      if (q < 1) return `${u.name}: quantity must be at least 1.`;
      if (q > ceiling) return qtyCapMessage(u.name, ceiling, u.remainingCoveredByRef ?? null);
    }
    return null;
  };

  // ── Submit ────────────────────────────────────────────────────
  const onSubmit = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    setSubmitting(true);
    try {
      // Reuse anything a previous attempt already staged — see
      // uploadedPhotosRef. Only upload when there's nothing banked.
      let taggedPhotos: Array<{ url: string; key: string; category: string }> =
        uploadedPhotosRef.current ?? [];
      if (!uploadedPhotosRef.current && photos.length > 0) {
        const form = new FormData();
        for (const p of photos) form.append("files", p.file, p.file.name);
        // Safe to repeat: each attempt stages under a fresh timestamped key.
        const upRes = await fetchOrNetworkError(
          `/api/returns/upload?orderId=${orderId}`,
          { method: "POST", body: form },
          { retries: 2 },
        );
        if (!upRes.ok) {
          throw new Error(await errorMessageFor(upRes, "Upload failed"));
        }
        const j = (await upRes.json()) as { photos: { url: string; key: string }[] };
        taggedPhotos = j.photos.map((p, i) => ({
          url: p.url,
          key: p.key,
          category: photos[i]?.category ?? "what_arrived",
        }));
      }
      uploadedPhotosRef.current = taggedPhotos;

      const itemsPayload = selectedIdxs.map((idx) => {
        const u = units[idx];
        const attrs = u.categoryName
          ? [{ name: "Category", value: u.categoryName }, ...u.attributes]
          : u.attributes;
        const missingComponentPath = u.isKitComponent
          ? {
              variantId: u.variantId,
              componentName: u.name,
              attributes: attrs,
            }
          : undefined;
        return {
          orderItemId: u.orderItemId,
          // Clamped once more at payload-build time — the UI cap is only ever
          // advisory, and the server caps it again in createMissingClaim.
          qtyShort: clampRequestedQty(qtyFor(idx), qtyCeiling(u)),
          missingComponentPath,
          notes: undefined,
        };
      });

      const body = {
        orderId,
        notes: undefined,
        photos: taggedPhotos,
        items: itemsPayload,
      };

      // NOT retried: this mints a MIS- claim. A silent retry after the server
      // already committed would raise a second claim for the same order. The
      // parent retries by tapping Submit again; staged photos are reused.
      const res = await fetchOrNetworkError("/api/missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(await errorMessageFor(res, "Submit failed"));
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/shop/orders/${orderId}/missing/${id}`);
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Something went wrong. Please tap Submit again.",
      );
      setSubmitting(false);
    }
  };

  // ── Render helpers: unit picker ───────────────────────────────
  // Single checkbox row — standalone items and components inside an
  // expanded kit group. (The individual-item flow is unchanged.)
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
              ? "border-rose-500 bg-rose-50/40 text-ink-900"
              : "border-ink-200 hover:border-ink-400 text-ink-700")
          }
        >
          <span
            className={
              "h-3.5 w-3.5 rounded-sm border-2 shrink-0 flex items-center justify-center " +
              (disabled
                ? "border-ink-200 bg-ink-100"
                : active ? "border-rose-500 bg-rose-500" : "border-ink-300")
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
                  {" "}· Pending delivery — Missing request is not available yet
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
                ? "border-rose-500/40 bg-white text-rose-700"
                : "border-ink-200 bg-cream-50 text-ink-500")
            }
          >
            {categoryLabel(u.kind)}
          </span>
        </button>
      </li>
    );
  };

  // Kit / Magic-Box card: one card for the family with a scope chooser.
  const kitGroupCard = (orderItemId: string) => {
    const g = kitGroups.get(orderItemId);
    if (!g) return null;
    const parent = units[g.parentIdx];
    if (!parent) return null;
    // Whole-box "never arrived" has been retired — a Magic Box can only be
    // reported item-by-item, so the scope is always "items" and the chooser
    // is gone.
    const scope = "items" as const;
    const compCount = g.compIdxs.length;
    // Disabled = an active request already covers this box.
    const disabled = !!parent.locked;
    return (
      <li key={`kit:${orderItemId}`}>
        <div
          className={
            "rounded-xl border overflow-hidden " +
            (disabled
              ? "border-ink-200 bg-cream-50/60"
              : scope ? "border-rose-400/60" : "border-ink-200")
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
          {!disabled && (
          <div className="p-3 space-y-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-500">
              Which items didn&apos;t arrive?
            </p>
            <p className="-mt-1 text-[11.5px] text-ink-500">
              Pick the specific items inside this box that weren&apos;t in it — the
              rest stays reported as received.
            </p>
            {(() => {
              const cats = categoriesFor(g.compIdxs);
              if (cats.size === 0) {
                return (
                  <ul className="space-y-1.5 pt-1">
                    {g.compIdxs.map((ci) => unitRow(units[ci], ci))}
                  </ul>
                );
              }
              // Ungrouped components (e.g. uniform pieces in a hybrid magic
              // box) render flat above the category accordions.
              const ungrouped = g.compIdxs.filter((ci) => !units[ci]?.categoryKey);

              const catLi = (catKey: string, cat: { name: string; idxs: number[] }) => {
                // "Whole category" acts only on SELECTABLE books — a locked /
                // not-yet-delivered book stays untouched so the category
                // checkbox can't sneak an ineligible item into the claim. The
                // count still shows the full category size.
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
                            ? "border-rose-500 bg-rose-500"
                            : someSelected
                            ? "border-rose-500 bg-rose-500/30"
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
                        <span className="block truncate text-[13px] font-medium text-ink-900">{cat.name}</span>
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

              // Group a nested magic-box bookkit's categories under a bookkit
              // header; a standalone bookkit's categories render directly.
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

      {/* Unit picker */}
      {!singleUnit ? (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-700">
            Which item(s) didn&apos;t arrive?
          </p>
          <p className="mt-1 text-[11.5px] text-ink-500">
            Tick every item that was missing — you can select more than one.
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
                // Whole-box "never arrived" is retired: a kit parent is never
                // selectable on its own. If its components couldn't be
                // resolved it falls out of kitGroups — drop it rather than
                // letting it render as a "whole box" row.
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
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-rose-500"
            />
            <span className="text-[12.5px] text-ink-700">
              I confirm the item(s) selected above are the ones that didn&apos;t arrive.
              <span className="text-red-500">*</span>
            </span>
          </label>
        </div>
      ) : (
        <div className="rounded-lg border border-ink-200 bg-cream-50/40 p-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-700">
            Reporting missing
          </p>
          <p className="mt-1 text-[13px] text-ink-800">{units[0].name}</p>
          <p className="text-[11.5px] text-ink-500">{unitDetailLabel(units[0]) || ""}</p>
        </div>
      )}

      {/* Per-unit qty short rows — only after confirmation. */}
      {selectionConfirmed && totalSelected > 0 && (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-700">
            How many were missing?
          </p>
          <p className="mt-1 text-[11.5px] text-ink-500">
            Enter the count that didn&apos;t arrive for each item.
          </p>
          <ul className="mt-2 space-y-1.5">
            {selectedIdxs.map((idx) => {
              const u = units[idx];
              if (!u) return null;
              return (
                <li
                  key={u.unitKey}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-2 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink-900 truncate">
                      {u.name}
                    </p>
                    <p className="text-[11.5px] text-ink-500 truncate">
                      {unitDetailLabel(u) || "—"}
                      {u.isKitComponent && (
                        <span className="text-ink-400"> · in {u.parentName}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11.5px] text-ink-500">Qty</span>
                    <input
                      type="number"
                      min={1}
                      max={qtyCeiling(u)}
                      value={qtyTextFor(idx)}
                      aria-label={`Quantity missing for ${u.name}, at most ${qtyCeiling(u)}`}
                      // Select-on-focus so a click-then-type REPLACES the
                      // number instead of appending to it ("2" typed next to
                      // an existing "2" is what produces a needless "22" →
                      // clamp → toast). The mouseup guard keeps the browser
                      // from collapsing that selection to a caret.
                      onFocus={(e) => e.target.select()}
                      onMouseUp={(e) => e.preventDefault()}
                      onChange={(e) => applyQtyInput(e.target, idx, "change")}
                      onBlur={(e) => applyQtyInput(e.target, idx, "blur")}
                      className="w-16 rounded-md border border-ink-200 bg-white px-2 py-1.5 text-[13px] text-right"
                    />
                    <span className="text-[11.5px] text-ink-500">
                      of {qtyCeiling(u)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Photos */}
      {selectionConfirmed && (
        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
            Photos (optional)
          </label>
          <p className="mt-1 text-[11.5px] text-ink-500">
            A picture of WHAT did arrive helps our team verify quickly.
          </p>
          {photos.length < MAX_FILES && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-ink-300 px-3 py-2 text-[12.5px] text-ink-700 hover:border-rose-500 hover:text-rose-700"
            >
              <Upload className="h-3.5 w-3.5" /> Add photo
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED.join(",")}
                multiple
                onChange={(e) => {
                  const input = e.currentTarget;
                  void stageFiles(input.files).finally(() => {
                    input.value = "";
                  });
                }}
                className="hidden"
              />
            </button>
          )}
          {photos.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {photos.map((p, idx) => (
                <li key={idx} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.previewUrl}
                    alt=""
                    className="h-16 w-16 object-cover rounded-md border border-ink-200"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-ink-200 text-ink-600 hover:text-rose-600"
                    aria-label="Remove photo"
                  >
                    <X className="h-3 w-3 mx-auto" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* CC contact card */}
      {selectionConfirmed && (
        <div className="rounded-lg bg-cream-50 border border-ink-200 p-3 text-[12.5px]">
          <p className="font-semibold text-ink-900">
            <Phone className="inline h-3.5 w-3.5 -mt-0.5 mr-1 text-ink-600" /> Need urgent help?
          </p>
          <p className="mt-0.5 text-ink-700">
            You can also call our customer care at <strong>{CC_PHONE}</strong> while we process this claim.
          </p>
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
        onClick={onSubmit}
        disabled={submitting || !selectionConfirmed}
        className="w-full rounded-xl bg-rose-600 py-3 font-display font-bold text-white text-[14px] hover:opacity-90 disabled:opacity-50 disabled:bg-ink-300 inline-flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting
          ? "Submitting…"
          : totalSelected > 1
            ? `Submit missing-item claim (${totalSelected} items)`
            : "Submit missing-item claim"}
      </button>
    </div>
  );
}

function ScopeOption({
  checked,
  onSelect,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
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
          ? "border-rose-500 bg-rose-50/40"
          : "border-ink-200 hover:border-ink-400 bg-white")
      }
    >
      <div className="flex items-start gap-2">
        <span
          className={
            "mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 " +
            (checked && !disabled ? "border-rose-500 bg-rose-500" : "border-ink-300")
          }
        />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-ink-900">{title}</p>
          <p className="text-[11.5px] text-ink-500 mt-0.5">{hint}</p>
        </div>
      </div>
    </div>
  );
}
