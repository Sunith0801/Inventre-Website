"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Loader2,
  Save,
  Trash2,
  Star,
  ArrowUp,
  ArrowDown,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { Card, CardHeader, Badge, Field as UiField, Input, Select, Checkbox, FormGrid, FormError } from "@/components/admin/ui/primitives";
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
  /** Percent, e.g. 5 or 12. Null = not set. */
  gstRate: number | null;
  /** YYYY-MM-DD or null. */
  priceEffectiveFrom: string | null;
  /** Rupees. Takes over as base price on priceEffectiveFrom. */
  scheduledBasePrice: number | null;
};

export function ProductBasicsForm({
  product,
  categories,
  afterBasics,
  section = "both",
}: {
  product: Fields;
  categories: { id: string; label: string; name: string }[];
  /** Rendered directly below the Basics card (e.g. variants / BOM editor). */
  afterBasics?: React.ReactNode;
  /** The stepper shows Basics and Pricing on different steps. */
  section?: "basics" | "pricing" | "both";
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
          // `status` is deliberately NOT sent: the Review & publish step
          // owns it, and it is gated there. Re-sending a stale value from
          // an open Basics tab used to silently un-publish products.
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
          gstRate: form.gstRate,
          priceEffectiveFrom: form.priceEffectiveFrom,
          scheduledBasePrice: form.scheduledBasePrice,
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
      {section !== "pricing" ? (
      <form onSubmit={submit} className="grid gap-5">
        <Card>
          <CardHeader title="Basics" />
          <FormGrid cols={3}>
            <UiField label="Name" htmlFor="pb-name" required className="sm:col-span-2 lg:col-span-3">
              <Input id="pb-name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
            </UiField>
            <UiField label="Item code" htmlFor="pb-code" hint="ERP / SKU master">
              <Input id="pb-code" value={form.itemCode ?? ""} onChange={(e) => set("itemCode", e.target.value || null)} className="font-mono" />
            </UiField>
            <UiField label="Brand" htmlFor="pb-brand">
              <Input id="pb-brand" value={form.brand ?? ""} onChange={(e) => set("brand", e.target.value || null)} />
            </UiField>
            <UiField label="Minimum order qty" htmlFor="pb-moq">
              <Input id="pb-moq" type="number" min={1} value={form.minOrderQty} onChange={(e) => set("minOrderQty", parseInt(e.target.value, 10) || 1)} className="text-right tabular-nums" />
            </UiField>
            <UiField label="Category" htmlFor="pb-category" className="sm:col-span-2 lg:col-span-2">
              <Select id="pb-category" value={form.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value || null)}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </Select>
            </UiField>
            <UiField label="Slug" htmlFor="pb-slug" hint="Part of the shop URL">
              <Input id="pb-slug" value={form.slug} onChange={(e) => set("slug", e.target.value)} className="font-mono" />
            </UiField>
            <UiField label="Tagline" htmlFor="pb-tagline" className="sm:col-span-2 lg:col-span-3">
              <Input id="pb-tagline" value={form.tagline} onChange={(e) => set("tagline", e.target.value)} maxLength={120} placeholder="One line under the name on the shop" />
            </UiField>
          </FormGrid>
          <div className="mt-5 flex items-center justify-end gap-3 border-t border-ink-100/70 pt-4">
            {saved ? <span className="text-[12.5px] font-medium text-emerald-700">Saved</span> : null}
            <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit" size="sm">
              Save basics
            </Button>
          </div>
        </Card>
      </form>
      ) : null}

      {/* Variants / BOM contents — sibling, directly under the Basics card. */}
      {afterBasics}

      {/* Pricing + Tax — a second form. */}
      {section !== "basics" ? (
      <form onSubmit={submit} className="grid gap-5">
        <Card>
          <CardHeader title="Pricing & tax" />
          <FormGrid cols={3}>
            <UiField label="Base price (₹)" htmlFor="pp-base" required hint="Used when a variant or school has no price of its own">
              <Input id="pp-base" type="number" min={0} value={form.basePrice} onChange={(e) => set("basePrice", parseInt(e.target.value, 10) || 0)} required className="text-right tabular-nums" />
            </UiField>
            <UiField label="Base MRP (₹)" htmlFor="pp-mrp" hint="Strike-through price on the shop">
              <Input id="pp-mrp" type="number" min={0} value={form.baseMrp ?? ""} onChange={(e) => set("baseMrp", e.target.value ? parseInt(e.target.value, 10) : null)} className="text-right tabular-nums" />
            </UiField>
            <UiField label="Cost price (₹)" htmlFor="pp-cost" hint="Used only by Bulk markup">
              <Input id="pp-cost" type="number" min={0} value={form.costPrice ? Math.round(form.costPrice / 100) : ""} onChange={(e) => set("costPrice", e.target.value ? parseInt(e.target.value, 10) * 100 : null)} className="text-right tabular-nums" />
            </UiField>
            <UiField label="GST rate (%)" htmlFor="pp-gstrate" hint="Once per product; every size shares it">
              <Select id="pp-gstrate" value={form.gstRate == null ? "" : String(form.gstRate)} onChange={(e) => set("gstRate", e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">Not set</option>
                {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
              </Select>
            </UiField>
            <UiField label="New base price (₹)" htmlFor="pp-sched" hint="Takes over on the date below; the current price sells until then">
              <Input id="pp-sched" type="number" min={0} value={form.scheduledBasePrice ?? ""} onChange={(e) => set("scheduledBasePrice", e.target.value ? parseInt(e.target.value, 10) : null)} className="text-right tabular-nums" placeholder="Same as base" />
            </UiField>
            <UiField label="Effective from" htmlFor="pp-eff" hint={form.scheduledBasePrice != null && !form.priceEffectiveFrom ? "Pick the date the new price starts" : "Applied at 00:05 that day"}>
              <Input id="pp-eff" type="date" value={form.priceEffectiveFrom ?? ""} onChange={(e) => set("priceEffectiveFrom", e.target.value || null)} invalid={form.scheduledBasePrice != null && !form.priceEffectiveFrom} />
            </UiField>
            <UiField label="HSN code" htmlFor="pp-hsn">
              <Input id="pp-hsn" value={form.hsnCode ?? ""} onChange={(e) => set("hsnCode", e.target.value || null)} placeholder="61012000" className="font-mono" />
            </UiField>
            <UiField label="GST treatment" htmlFor="pp-gst">
              <Select id="pp-gst" value={form.gstTreatment} onChange={(e) => set("gstTreatment", e.target.value as Fields["gstTreatment"])}>
                <option value="nil_rated">Nil-rated (uniforms)</option>
                <option value="taxable">Taxable</option>
                <option value="exempt">Exempt</option>
                <option value="zero_rated">Zero-rated (export)</option>
                <option value="non_gst">Non-GST</option>
              </Select>
            </UiField>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <Checkbox label="Price includes GST" checked={form.gstInclusive} onChange={(e) => set("gstInclusive", e.target.checked)} />
              <Checkbox label="Magic Box" hint="Premium curated bundle" checked={form.isMagicBox} onChange={(e) => set("isMagicBox", e.target.checked)} />
            </div>
          </FormGrid>
          <FormError className="mt-4">{error}</FormError>
          <div className="mt-5 flex items-center justify-end gap-3 border-t border-ink-100/70 pt-4">
            {saved ? <span className="text-[12.5px] font-medium text-emerald-700">Saved</span> : null}
            <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit" size="sm">
              Save pricing & tax
            </Button>
          </div>
        </Card>
      </form>
      ) : null}
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
      <CardHeader title="Targeted grades" description="Leave every grade unselected to show the product to all grades." />
      {(() => {
        const chip = (g: string) => {
          const on = grades.includes(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => toggle(g)}
              className={cn(
                "h-8 rounded-lg border px-2.5 text-[12px] font-medium transition-colors",
                on
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-ink-100 bg-white text-ink-700 hover:border-ink-300"
              )}
            >
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
              <div className="mt-4 border-t border-ink-100/70 pt-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">DSE grades</div>
                <div className="flex flex-wrap gap-1.5">
                  {dseGradeOptions.map(chip)}
                </div>
              </div>
            ) : null}
          </>
        );
      })()}
      <div className="mt-4 flex items-center justify-between border-t border-ink-100/70 pt-4">
        <span className="text-[12.5px] text-ink-600">
          {grades.length === 0 ? "All grades" : `${grades.length} grade${grades.length > 1 ? "s" : ""} selected`}
        </span>
        <div className="flex items-center gap-3">
          {saved ? <span className="text-[12.5px] font-medium text-emerald-700">Saved</span> : null}
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

type Img = {
  id: string;
  url: string;
  alt: string | null;
  isPrimary?: boolean;
  /** Colour tag — product_attribute_values.id (e.g. Colour=Blue). The PDP
   *  gallery surfaces tagged images when that colour is selected. */
  attributeValueId?: string | null;
  /** Pinned to one variant (a specific size). Null = every size. */
  variantId?: string | null;
};

export function ProductImages({
  productId,
  initial,
  colourOptions = [],
  variantOptions = [],
}: {
  productId: string;
  initial: Img[];
  /** The product's variants, for the "only for this size" pin. */
  variantOptions?: { id: string; label: string }[];
  /** Colour values used by this product's variants; empty = product has no
   *  colour axis and the per-image colour dropdown is hidden. */
  colourOptions?: { id: string; label: string }[];
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

  const setColour = async (img: Img, attributeValueId: string | null) => {
    const before = images;
    setImages((cur) =>
      cur.map((i) => (i.id === img.id ? { ...i, attributeValueId } : i))
    );
    const r = await fetch(`/api/admin/products/${productId}/images/${img.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributeValueId }),
    });
    if (!r.ok) {
      setImages(before);
      setError("Could not save colour tag");
    }
  };

  // Third image level: a photo that belongs to ONE size. Rare — a size
  // that genuinely looks different — so it is a small select, not a
  // second upload area, and duplicates are never needed.
  const setVariant = async (img: Img, variantId: string | null) => {
    const before = images;
    setImages((cur) => cur.map((i) => (i.id === img.id ? { ...i, variantId } : i)));
    const r = await fetch(`/api/admin/products/${productId}/images/${img.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId }),
    });
    if (!r.ok) {
      setImages(before);
      setError("Could not save the size pin");
    }
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
      <CardHeader title="Images" description="The first image is the shop card. Use the arrows to reorder." />

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
          "block cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-colors",
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
        <ul className="mt-4 divide-y divide-ink-100/70 rounded-xl border border-ink-100/70 bg-white">
          {images.map((img, i) => (
            <li key={img.id} className="p-2.5">
              <div className="flex items-center gap-3">
                {/* Thumbnail + order badge */}
                <div className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt ?? ""}
                    className="h-14 w-14 rounded-lg border border-ink-100 bg-cream-50 object-contain"
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
                  {colourOptions.length > 0 ? (
                    <select
                      value={img.attributeValueId ?? ""}
                      onChange={(e) =>
                        void setColour(img, e.target.value || null)
                      }
                      className="mt-1.5 h-7 max-w-full rounded-md border border-ink-100 bg-cream-50 px-1.5 text-[11px] text-ink-700 focus:border-ink-300 focus:outline-none"
                      title="Colour this image shows — the storefront gallery surfaces it when that colour is selected"
                    >
                      <option value="">No colour tag</option>
                      {colourOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {variantOptions.length > 0 ? (
                    <select
                      value={img.variantId ?? ""}
                      onChange={(e) => void setVariant(img, e.target.value || null)}
                      className="mt-1 ml-1 h-7 max-w-full rounded-md border border-ink-100 bg-cream-50 px-1.5 text-[11px] text-ink-700 focus:border-ink-300 focus:outline-none"
                      title="Only for one size — use when a size genuinely looks different"
                    >
                      <option value="">Every size</option>
                      {variantOptions.map((v) => (
                        <option key={v.id} value={v.id}>Only {v.label}</option>
                      ))}
                    </select>
                  ) : null}
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
        <p className="mt-3 text-center text-[12.5px] text-ink-500">No images yet.</p>
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
        "grid h-7 w-7 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-30",
        destructive
          ? "text-ink-300 hover:bg-red-50 hover:text-red-600"
          : "text-ink-400 hover:bg-cream-100 hover:text-ink-900"
      )}
    >
      {children}
    </button>
  );
}
