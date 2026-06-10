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

type Unit = {
  unitKey: string;
  orderItemId: string;
  parentName: string;
  isKitComponent: boolean;
  name: string;
  size: string;
  qty: number;
  variantId: string;
  kind: string;
  attributes: { name: string; value: string }[];
};

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
  const [notes, setNotes] = useState<string>("");
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const qtyFor = (idx: number): number => {
    const v = qtyShortByIdx[idx];
    if (typeof v === "number") return v;
    return units[idx]?.qty ?? 1;
  };

  const setQtyFor = (idx: number, value: number) => {
    const max = units[idx]?.qty ?? 1;
    const clamped = Math.max(1, Math.min(max, value || 1));
    setQtyShortByIdx((prev) => ({ ...prev, [idx]: clamped }));
  };

  const totalSelected = useMemo(() => selectedIdxs.length, [selectedIdxs]);

  // ── Photo handling ────────────────────────────────────────────
  const stageFiles = (files: FileList | null) => {
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
      incoming.push({
        file: f,
        category: "what_arrived",
        previewUrl: URL.createObjectURL(f),
      });
    }
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
      if (q < 1) return `${u.name}: quantity must be at least 1.`;
      if (q > u.qty) return `${u.name}: only ${u.qty} ordered, can't be more than that missing.`;
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
      let taggedPhotos: Array<{ url: string; key: string; category: string }> = [];
      if (photos.length > 0) {
        const form = new FormData();
        for (const p of photos) form.append("files", p.file, p.file.name);
        const upRes = await fetch(`/api/returns/upload?orderId=${orderId}`, {
          method: "POST",
          body: form,
        });
        if (!upRes.ok) {
          const j = await upRes.json().catch(() => ({}));
          throw new Error(j.error ?? `Upload failed (${upRes.status})`);
        }
        const j = (await upRes.json()) as { photos: { url: string; key: string }[] };
        taggedPhotos = j.photos.map((p, i) => ({
          url: p.url,
          key: p.key,
          category: photos[i]?.category ?? "what_arrived",
        }));
      }

      const itemsPayload = selectedIdxs.map((idx) => {
        const u = units[idx];
        const missingComponentPath = u.isKitComponent
          ? {
              variantId: u.variantId,
              componentName: u.name,
              attributes: u.attributes,
            }
          : undefined;
        return {
          orderItemId: u.orderItemId,
          qtyShort: qtyFor(idx),
          missingComponentPath,
          notes: undefined,
        };
      });

      const body = {
        orderId,
        notes: notes.trim() || undefined,
        photos: taggedPhotos,
        items: itemsPayload,
      };

      const res = await fetch("/api/missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Submit failed (${res.status})`);
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/shop/orders/${orderId}/missing/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

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

      {/* Unit picker */}
      {!singleUnit ? (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-700">
            Which item(s) didn&apos;t arrive?
          </p>
          <p className="mt-1 text-[11.5px] text-ink-500">
            Tick every item that was missing — you can select more than one.
          </p>
          <ul className="mt-2 space-y-1.5">
            {units.map((u, idx) => {
              const active = selectedIdxs.includes(idx);
              const toggle = () => {
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
                    className={
                      "w-full text-left rounded-lg border px-3 py-2 text-[13px] flex items-center gap-2 " +
                      (active
                        ? "border-rose-500 bg-rose-50/40 text-ink-900"
                        : "border-ink-200 hover:border-ink-400 text-ink-700")
                    }
                  >
                    <span
                      className={
                        "h-3.5 w-3.5 rounded-sm border-2 shrink-0 flex items-center justify-center " +
                        (active ? "border-rose-500 bg-rose-500" : "border-ink-300")
                      }
                    >
                      {active && (
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
                        {u.isKitComponent && (
                          <span className="text-ink-400"> · in {u.parentName}</span>
                        )}
                      </span>
                    </span>
                    <span
                      className={
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider " +
                        (active
                          ? "border-rose-500/40 bg-white text-rose-700"
                          : "border-ink-200 bg-cream-50 text-ink-500")
                      }
                    >
                      {categoryLabel(u.kind)}
                    </span>
                  </button>
                </li>
              );
            })}
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
                    <input
                      type="number"
                      min={1}
                      max={u.qty}
                      value={qtyFor(idx)}
                      onChange={(e) => setQtyFor(idx, Number(e.target.value))}
                      className="w-16 rounded-md border border-ink-200 bg-white px-2 py-1.5 text-[13px] text-right"
                    />
                    <span className="text-[11.5px] text-ink-500">of {u.qty}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Notes */}
      {selectionConfirmed && (
        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
            Any details (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. The box had a small tear but everything else was inside."
            className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[14px]"
          />
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
                onChange={(e) => stageFiles(e.target.files)}
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
