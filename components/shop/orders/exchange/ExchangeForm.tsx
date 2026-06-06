"use client";

/**
 * Customer-facing form for raising an exchange request. Rendered by
 * /shop/orders/[id]/exchange/new — that page does the phone-gate +
 * order-ownership server checks before this client component mounts,
 * so the form itself only handles UX (upload progress, validation,
 * submit).
 *
 * Submit flow:
 *   1. POST /api/returns/upload?orderId=... (multipart, files)
 *   2. POST /api/returns with { kind:'exchange', orderId, items, reason,
 *      notes, photos:[{url,key},...] }
 *   3. Redirect to /shop/orders/<id>/exchange/<returnId>
 *
 * Failures at step 1 abort step 2 — we never want a return row without
 * its evidence photos.
 */

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, AlertCircle, Loader2 } from "lucide-react";
import { EXCHANGE_REASONS } from "@/lib/exchange-shared";

type Item = {
  orderItemId: string;
  name: string;
  size: string;
  qty: number;
  imageUrl: string;
};

const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function ExchangeForm({
  orderId,
  item,
}: {
  orderId: string;
  item: Item;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPickFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setError(null);
    const next: File[] = [];
    for (const f of Array.from(incoming)) {
      if (!ALLOWED.includes(f.type)) {
        setError(`"${f.name}": only JPEG, PNG, or WebP photos are allowed.`);
        return;
      }
      if (f.size > MAX_BYTES) {
        setError(`"${f.name}": each photo must be under 8 MB.`);
        return;
      }
      next.push(f);
    }
    const merged = [...files, ...next].slice(0, MAX_FILES);
    if (next.length > 0 && merged.length >= MAX_FILES) {
      // signal at-cap so users know further drops are ignored
      setError(`You can attach at most ${MAX_FILES} photos.`);
    }
    setFiles(merged);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSubmit = async () => {
    setError(null);
    if (!reason) {
      setError("Please select a reason.");
      return;
    }
    if (files.length === 0) {
      setError("Please attach at least one photo so our team can verify.");
      return;
    }
    setSubmitting(true);
    try {
      // 1. Upload photos
      const form = new FormData();
      for (const f of files) form.append("files", f, f.name);
      const upRes = await fetch(`/api/returns/upload?orderId=${orderId}`, {
        method: "POST",
        body: form,
      });
      if (!upRes.ok) {
        const j = await upRes.json().catch(() => ({}));
        throw new Error(j.error ?? `Upload failed (${upRes.status})`);
      }
      const { photos } = (await upRes.json()) as {
        photos: { url: string; key: string }[];
      };

      // 2. Create exchange request
      const body = {
        orderId,
        kind: "exchange" as const,
        reason,
        notes: notes.trim() || undefined,
        photos,
        items: [{ orderItemId: item.orderItemId, qty: item.qty }],
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

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5 lg:p-6">
      {/* Item being exchanged */}
      <div className="flex gap-3 pb-4 border-b border-ink-100">
        <div className="h-16 w-16 shrink-0 rounded-lg bg-cream-100 border border-ink-100 overflow-hidden">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt=""
              className="h-full w-full object-contain p-1.5"
            />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-ink-900 text-[14px]">{item.name}</p>
          <p className="text-[12px] text-ink-500">
            {item.size ? `Size ${item.size} · ` : ""}× {item.qty}
          </p>
        </div>
      </div>

      {/* Reason */}
      <label className="mt-5 block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
        Reason
      </label>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[14px]"
      >
        <option value="">Select a reason…</option>
        {EXCHANGE_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      {/* Notes */}
      <label className="mt-5 block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
        Additional details (optional)
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="e.g. The shirt's stitching has come undone near the collar."
        className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-[14px] leading-relaxed resize-none"
      />

      {/* Photos */}
      <label className="mt-5 block text-[12px] font-semibold uppercase tracking-wider text-ink-700">
        Photos · {files.length} / {MAX_FILES}
      </label>
      <p className="mt-1 text-[11.5px] text-ink-500">
        Clear, well-lit photos help us approve faster. JPEG, PNG, or WebP — up
        to 8 MB each.
      </p>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {files.map((f, i) => {
          const url = URL.createObjectURL(f);
          return (
            <div
              key={`${f.name}-${i}`}
              className="relative aspect-square rounded-lg border border-ink-100 bg-cream-50 overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="h-full w-full object-cover"
                onLoad={() => URL.revokeObjectURL(url)}
              />
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute top-1 right-1 h-6 w-6 grid place-items-center rounded-full bg-white/90 border border-ink-200 hover:bg-white"
                aria-label="Remove photo"
              >
                <X className="h-3.5 w-3.5 text-ink-700" />
              </button>
            </div>
          );
        })}
        {files.length < MAX_FILES && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="aspect-square rounded-lg border-2 border-dashed border-ink-200 bg-white hover:border-brand hover:bg-cream-50 flex flex-col items-center justify-center gap-1 text-[11.5px] font-medium text-ink-600 hover:text-brand"
          >
            <Upload className="h-5 w-5" />
            Add photo
          </button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED.join(",")}
        multiple
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="mt-6 w-full rounded-xl bg-brand py-3 font-display font-bold text-white text-[14px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting ? "Submitting…" : "Submit exchange request"}
      </button>
    </div>
  );
}
