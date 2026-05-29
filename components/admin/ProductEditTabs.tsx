"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Loader2,
  Image as ImageIcon,
  Save,
  Trash2,
  GraduationCap,
  Star,
  ArrowUp,
  ArrowDown,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";
import { cn } from "@/lib/cn";

// ────────────────────────────────────────────────────────────
// Basics + pricing + tax — all fields the audit said were missing
// ────────────────────────────────────────────────────────────

type Fields = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  basePrice: number; // rupees
  baseMrp: number | null;
  categoryId: string | null;
  status: "active" | "draft" | "archived";
  itemCode: string | null;
  hsnCode: string | null;
  gstTreatment: "taxable" | "nil_rated" | "exempt" | "non_gst" | "zero_rated";
  gstInclusive: boolean;
  brand: string | null;
  displayPrice: number | null;
  costPrice: number | null;
  organizationMrp: number | null;
  customerDiscountPercent: string | null;
  weightGrams: number | null;
  minOrderQty: number;
  isMagicBox: boolean;
};

export function ProductBasicsForm({
  product,
  categories,
  afterBasics,
}: {
  product: Fields;
  categories: { id: string; label: string; name: string }[];
  /** Rendered directly below the Basics card (e.g. variants / BOM editor). */
  afterBasics?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<Fields>(product);

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/products/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          tagline: form.tagline || null,
          basePrice: form.basePrice,
          baseMrp: form.baseMrp,
          categoryId: form.categoryId,
          status: form.status,
          // The audit-aligned fields
          itemCode: form.itemCode,
          hsnCode: form.hsnCode,
          gstTreatment: form.gstTreatment,
          gstInclusive: form.gstInclusive,
          brand: form.brand,
          displayPrice: form.displayPrice,
          costPrice: form.costPrice,
          organizationMrp: form.organizationMrp,
          customerDiscountPercent: form.customerDiscountPercent
            ? Number(form.customerDiscountPercent)
            : null,
          weightGrams: form.weightGrams,
          minOrderQty: form.minOrderQty,
          isMagicBox: form.isMagicBox,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-5">
      {/* Basics — its own form so the variants/BOM editor can sit
          between it and Pricing without nesting forms. */}
      <form onSubmit={submit} className="grid gap-5">
      {/* Basics */}
      <Card>
        <CardHeader title="Basics" description="Identity, classification, and status" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Field label="Name" required>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Slug" hint="URL-safe identifier">
            <input
              type="text"
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
              className={cn(inputClass, "font-mono")}
            />
          </Field>
          <Field label="Item code (ERP / SKU master)" hint="e.g. KLS Boys Shirt">
            <input
              type="text"
              value={form.itemCode ?? ""}
              onChange={(e) => set("itemCode", e.target.value || null)}
              className={cn(inputClass, "font-mono")}
            />
          </Field>
          <Field label="Brand">
            <input
              type="text"
              value={form.brand ?? ""}
              onChange={(e) => set("brand", e.target.value || null)}
              className={inputClass}
            />
          </Field>
          <Field label="Category" className="lg:col-span-2">
            <select
              value={form.categoryId ?? ""}
              onChange={(e) => set("categoryId", e.target.value || null)}
              className={inputClass}
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tagline" className="lg:col-span-2">
            <input
              type="text"
              value={form.tagline}
              onChange={(e) => set("tagline", e.target.value)}
              className={inputClass}
              maxLength={120}
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value as Fields["status"])}
              className={inputClass}
            >
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
          <Field label="Min order qty">
            <input
              type="number"
              min={1}
              value={form.minOrderQty}
              onChange={(e) => set("minOrderQty", parseInt(e.target.value, 10) || 1)}
              className={inputClass}
            />
          </Field>
        </div>
        {/* Inline save anchored to the Basics card so admins can commit a
            name / status / category tweak without scrolling past BOM,
            Pricing and Tax. Reuses the same `submit` handler the bottom
            Save changes button uses — same persisted payload. */}
        <div className="mt-4 pt-3 border-t border-ink-100 flex items-center justify-end gap-3">
          <span className="text-[11px] text-ink-500 max-w-[24rem] text-right leading-snug">
            Saves Basics, Pricing &amp; Tax in one go. BOM and Content have
            their own Save buttons below.
          </span>
          {saved ? (
            <span className="text-[12px] text-emerald-700">✓ Saved</span>
          ) : null}
          <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit" size="sm">
            Save Basics
          </Button>
        </div>
      </Card>

      </form>

      {/* Variants / BOM contents — sibling, directly under the Basics card. */}
      {afterBasics}

      {/* Pricing + Tax — a second form. */}
      <form onSubmit={submit} className="grid gap-5">
      {/* Pricing */}
      <Card>
        <CardHeader
          title="Pricing"
          description="All amounts in ₹ rupees. Inventre cost is internal; display price is what customers see."
        />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Cost price (₹)" hint="Internal — your cost">
            <input
              type="number"
              min={0}
              value={form.costPrice ? Math.round(form.costPrice / 100) : ""}
              onChange={(e) =>
                set("costPrice", e.target.value ? parseInt(e.target.value, 10) * 100 : null)
              }
              className={inputClass}
            />
          </Field>
          <Field label="Base price (₹)" required hint="Selling price (paise stored)">
            <input
              type="number"
              min={0}
              value={form.basePrice}
              onChange={(e) => set("basePrice", parseInt(e.target.value, 10) || 0)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Display price (₹)" hint="Shown on shop card">
            <input
              type="number"
              min={0}
              value={form.displayPrice ? Math.round(form.displayPrice / 100) : ""}
              onChange={(e) =>
                set("displayPrice", e.target.value ? parseInt(e.target.value, 10) * 100 : null)
              }
              className={inputClass}
            />
          </Field>
          <Field label="Base MRP (₹)" hint="Strike-through price">
            <input
              type="number"
              min={0}
              value={form.baseMrp ?? ""}
              onChange={(e) =>
                set("baseMrp", e.target.value ? parseInt(e.target.value, 10) : null)
              }
              className={inputClass}
            />
          </Field>
          <Field label="School MRP (₹)" hint="Org-specific MRP">
            <input
              type="number"
              min={0}
              value={form.organizationMrp ? Math.round(form.organizationMrp / 100) : ""}
              onChange={(e) =>
                set(
                  "organizationMrp",
                  e.target.value ? parseInt(e.target.value, 10) * 100 : null
                )
              }
              className={inputClass}
            />
          </Field>
          <Field label="Customer discount %" hint="Auto-applied at cart">
            <input
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={form.customerDiscountPercent ?? ""}
              onChange={(e) => set("customerDiscountPercent", e.target.value || null)}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      {/* Tax & Compliance */}
      <Card>
        <CardHeader
          title="Tax & GST"
          description="HSN code drives the GST treatment. Inclusive vs exclusive determines whether the displayed price already contains tax."
        />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="HSN code" hint="e.g. 61012000 for uniforms">
            <input
              type="text"
              value={form.hsnCode ?? ""}
              onChange={(e) => set("hsnCode", e.target.value || null)}
              className={cn(inputClass, "font-mono")}
            />
          </Field>
          <Field label="GST treatment">
            <select
              value={form.gstTreatment}
              onChange={(e) => set("gstTreatment", e.target.value as Fields["gstTreatment"])}
              className={inputClass}
            >
              <option value="nil_rated">Nil-Rated (uniforms)</option>
              <option value="taxable">Taxable</option>
              <option value="exempt">Exempt</option>
              <option value="zero_rated">Zero-Rated (export)</option>
              <option value="non_gst">Non-GST</option>
            </select>
          </Field>
          <Field label="Price includes GST">
            <label className="flex items-center gap-2 h-9">
              <input
                type="checkbox"
                checked={form.gstInclusive}
                onChange={(e) => set("gstInclusive", e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-[13px] text-ink-700">Inclusive (default)</span>
            </label>
          </Field>
          <Field label="Weight (grams)">
            <input
              type="number"
              min={0}
              value={form.weightGrams ?? ""}
              onChange={(e) =>
                set("weightGrams", e.target.value ? parseInt(e.target.value, 10) : null)
              }
              className={inputClass}
            />
          </Field>
          <Field label="Magic Box?">
            <label className="flex items-center gap-2 h-9">
              <input
                type="checkbox"
                checked={form.isMagicBox}
                onChange={(e) => set("isMagicBox", e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-[13px] text-ink-700">Premium curated bundle</span>
            </label>
          </Field>
        </div>
      </Card>

      {/* Save */}
      <div className="flex items-center justify-end gap-3">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        {saved ? <span className="text-[13px] text-emerald-700">✓ Saved</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Save changes
        </Button>
      </div>
      </form>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Grade picker
// ────────────────────────────────────────────────────────────

const ALL_GRADES = [
  "Nursery",
  "LKG",
  "UKG",
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
];

// DSE-specific grade tags. Use these for products that should ONLY
// surface to DSE-stream students (regular Grade-N students don't see
// them). Rendered as their own "DSE grades" group in the picker.
const DSE_GRADES = [
  "Grade 1 DSE", "Grade 2 DSE", "Grade 3 DSE", "Grade 4 DSE",
  "Grade 5 DSE", "Grade 6 DSE", "Grade 7 DSE", "Grade 8 DSE",
  "Grade 9 DSE", "Grade 10 DSE", "Grade 11 DSE", "Grade 12 DSE",
  "Grade 13 DSE",
];

export function GradesPicker({
  productId,
  initial,
  allGrades,
}: {
  productId: string;
  initial: string[];
  /** Full set of grades to offer — the real ERP uniform grades. Falls back
   *  to the static list. Always unioned with the product's own grades so a
   *  mapped grade is never hidden. */
  allGrades?: string[];
}) {
  const [grades, setGrades] = useState<string[]>(initial);
  const gradeOptions = Array.from(
    new Set([
      ...(allGrades && allGrades.length ? allGrades : ALL_GRADES),
      ...DSE_GRADES,
      ...initial,
    ])
  );
  // DSE is a separate grade stream — render it as its own group.
  const standardGradeOptions = gradeOptions.filter((g) => !/dse/i.test(g));
  const dseGradeOptions = gradeOptions.filter((g) => /dse/i.test(g));
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const toggle = (g: string) => {
    setGrades((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
    setSaved(false);
  };

  const save = () => {
    start(async () => {
      await fetch(`/api/admin/products/${productId}/grades`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grades }),
      });
      setSaved(true);
    });
  };

  return (
    <Card>
      <CardHeader
        title="Targeted grades"
        description="Parents only see this product when their student's grade matches. Empty = available to all grades."
      />
      {(() => {
        const chip = (g: string) => {
          const on = grades.includes(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => toggle(g)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors",
                on
                  ? "bg-ink-900 text-white border-ink-900"
                  : "bg-white text-ink-700 border-ink-200 hover:border-ink-400"
              )}
            >
              <GraduationCap className="h-3 w-3 inline-block mr-1 -mt-0.5" />
              {g}
            </button>
          );
        };
        return (
          <>
            <div className="flex flex-wrap gap-1.5">
              {standardGradeOptions.map(chip)}
            </div>
            {dseGradeOptions.length > 0 ? (
              <div className="mt-3 pt-3 border-t border-ink-100/60">
                <div className="text-[10px] font-semibold tracking-wider uppercase text-ink-500 mb-1.5">
                  DSE grades
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {dseGradeOptions.map(chip)}
                </div>
              </div>
            ) : null}
          </>
        );
      })()}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-ink-100/60">
        <span className="text-[12px] text-ink-500">
          {grades.length === 0
            ? "Showing to all grades"
            : `${grades.length} grade${grades.length > 1 ? "s" : ""} selected`}
        </span>
        <div className="flex items-center gap-3">
          {saved ? <span className="text-[12px] text-emerald-700">✓ Saved</span> : null}
          <Button busy={pending} onClick={save} variant="primary" size="sm">
            Save grades
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────
// Images editor (inline)
// ────────────────────────────────────────────────────────────

type Img = { id: string; url: string; alt: string | null; isPrimary?: boolean };

export function ProductImages({
  productId,
  initial,
}: {
  productId: string;
  initial: Img[];
}) {
  const router = useRouter();
  const [images, setImages] = useState<Img[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [editingAltId, setEditingAltId] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const persistOrder = async (
    next: Img[],
    revert: () => void
  ): Promise<boolean> => {
    setError(null);
    const order = next.map((i) => i.id);
    try {
      const r = await fetch(
        `/api/admin/products/${productId}/images/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order }),
        }
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `Reorder failed (${r.status})`);
      }
      router.refresh();
      return true;
    } catch (e) {
      revert();
      setError(e instanceof Error ? e.message : "Reorder failed");
      return false;
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", `products/${productId}`);
      const up = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!up.ok) {
        const d = await up.json().catch(() => ({}));
        throw new Error(d.error ?? "Upload failed");
      }
      const { url } = await up.json();
      const add = await fetch(`/api/admin/products/${productId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, alt: file.name }),
      });
      if (!add.ok) throw new Error("Could not save image record");
      const { image } = await add.json();
      setImages((cur) => [...cur, image]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this image?")) return;
    const r = await fetch(`/api/admin/products/${productId}/images/${id}`, {
      method: "DELETE",
    });
    if (r.ok) {
      setImages((cur) => cur.filter((i) => i.id !== id));
      router.refresh();
    }
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= images.length) return;
    const before = images;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    setImages(next);
    await persistOrder(next, () => setImages(before));
  };

  const setPrimary = async (i: number) => {
    if (i === 0) return;
    const before = images;
    const next = [images[i], ...images.filter((_, idx) => idx !== i)];
    setImages(next);
    await persistOrder(next, () => setImages(before));
  };

  const startEditAlt = (img: Img) => {
    setEditingAltId(img.id);
    setAltDraft(img.alt ?? "");
  };
  const saveAlt = async (img: Img) => {
    const r = await fetch(
      `/api/admin/products/${productId}/images/${img.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alt: altDraft }),
      }
    );
    if (r.ok) {
      setImages((cur) =>
        cur.map((i) => (i.id === img.id ? { ...i, alt: altDraft } : i))
      );
      setEditingAltId(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Images"
        description="Image #1 is shown on shop cards and is the main PDP image. Use ★ to promote any image to #1, ← → to reorder, ✎ to edit alt text, 🗑 to delete."
      />

      {/* Drop zone */}
      <label
        htmlFor={`upload-${productId}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const files = Array.from(e.dataTransfer.files);
          for (const f of files) void upload(f);
        }}
        className={cn(
          "block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          drag
            ? "border-brand-400 bg-brand-50"
            : "border-ink-200 bg-cream-50 hover:bg-cream-100",
          uploading && "opacity-60 pointer-events-none"
        )}
      >
        <input
          ref={inputRef}
          id={`upload-${productId}`}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            for (const f of files) void upload(f);
          }}
        />
        {uploading ? (
          <Loader2 className="h-6 w-6 mx-auto text-brand-600 animate-spin" />
        ) : (
          <Upload className="h-6 w-6 mx-auto text-ink-400" />
        )}
        <p className="mt-2 text-[13px] font-semibold text-ink-900">
          {uploading ? "Uploading…" : "Drop images, or click to browse"}
        </p>
        <p className="text-[11px] text-ink-500 mt-0.5">JPG, PNG, WebP up to 10 MB each</p>
      </label>

      {error ? <p className="mt-3 text-[12px] text-red-700">{error}</p> : null}

      {/* List — one image per row, fits narrow admin columns.
          Each row: thumbnail (with order #) | label | action buttons. */}
      {images.length > 0 ? (
        <ul className="mt-5 divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white">
          {images.map((img, i) => (
            <li key={img.id} className="p-3">
              <div className="flex items-center gap-3">
                {/* Thumbnail + order badge */}
                <div className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt ?? ""}
                    className="h-16 w-16 rounded-lg object-cover bg-cream-50 border border-ink-100"
                  />
                  <span
                    className={cn(
                      "absolute -top-2 -left-2 grid place-items-center min-w-[24px] h-[24px] px-1 rounded-full text-[11px] font-bold shadow-sm border-2 border-white",
                      i === 0 ? "bg-brand-600 text-white" : "bg-ink-900 text-white"
                    )}
                    title={i === 0 ? "PRIMARY — shown on shop cards & PDP" : `Image #${i + 1}`}
                  >
                    {i + 1}
                  </span>
                </div>

                {/* Label + alt text */}
                <div className="flex-1 min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                    {i === 0 ? (
                      <>
                        <Star className="h-3.5 w-3.5 fill-brand-600 text-brand-600" />
                        <span>Primary (shop card)</span>
                      </>
                    ) : (
                      <span>Image #{i + 1}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-ink-500 truncate mt-0.5">
                    {img.alt || <span className="italic text-ink-400">no alt text</span>}
                  </p>
                </div>

                {/* Always-visible actions */}
                <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                  {i !== 0 ? (
                    <ImgBtn
                      onClick={() => setPrimary(i)}
                      title="Make primary (shop card image)"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </ImgBtn>
                  ) : null}
                  <ImgBtn
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </ImgBtn>
                  <ImgBtn
                    onClick={() => move(i, 1)}
                    disabled={i === images.length - 1}
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </ImgBtn>
                  <ImgBtn
                    onClick={() => startEditAlt(img)}
                    title="Edit alt text"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </ImgBtn>
                  <ImgBtn
                    onClick={() => remove(img.id)}
                    destructive
                    title="Delete image"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </ImgBtn>
                </div>
              </div>

              {/* Alt-text editor (only when editing) */}
              {editingAltId === img.id ? (
                <div className="mt-3 flex items-center gap-1">
                  <input
                    type="text"
                    value={altDraft}
                    autoFocus
                    onChange={(e) => setAltDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveAlt(img);
                      if (e.key === "Escape") setEditingAltId(null);
                    }}
                    className="flex-1 h-8 px-2 text-[12px] rounded border border-ink-200 outline-none focus:border-ink-400"
                    placeholder="Describe the image (used as alt text)…"
                  />
                  <button
                    type="button"
                    onClick={() => void saveAlt(img)}
                    className="grid h-8 w-8 place-items-center rounded text-emerald-600 hover:bg-emerald-50"
                    title="Save"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingAltId(null)}
                    className="grid h-8 w-8 place-items-center rounded text-ink-500 hover:bg-cream-100"
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-5 grid place-items-center py-6 text-ink-400">
          <ImageIcon className="h-8 w-8" />
          <p className="mt-2 text-[12px]">No images yet</p>
        </div>
      )}
    </Card>
  );
}

function ImgBtn({
  onClick,
  disabled,
  destructive,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-full bg-white/90 transition-colors disabled:opacity-30 disabled:pointer-events-none shadow-sm",
        destructive
          ? "text-red-600 hover:bg-red-600 hover:text-white"
          : "text-ink-700 hover:bg-ink-900 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      {hint ? <span className="text-[11px] text-ink-500 ml-2">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
