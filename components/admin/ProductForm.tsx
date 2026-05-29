"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, Plus, EyeOff, Send, CheckCircle2, Archive } from "lucide-react";

type ProductKind =
  | "kit"
  | "magic_box"
  | "sub_bundle"
  | "uniform"
  | "accessory"
  | "book"
  | "consumable"
  | "excluded";

type ProductFields = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  basePrice: number;
  baseMrp: number | null;
  categoryId: string | null;
  status: "active" | "draft" | "archived";
};

const KIND_OPTIONS: { value: ProductKind; label: string; hint: string }[] = [
  { value: "kit", label: "Bookkit (kit)", hint: "School+grade bundle of books / sub-bundles" },
  { value: "magic_box", label: "Magic Box (magic_box)", hint: "Root bundle for new students" },
  { value: "sub_bundle", label: "Sub-bundle (sub_bundle)", hint: "Notebook / Stationery container" },
  { value: "uniform", label: "Uniform (uniform)", hint: "Shirt / Pants / Frock with size×colour" },
  { value: "accessory", label: "Accessory (accessory)", hint: "Bag / Bottle / Belt / Cap" },
  { value: "book", label: "Book (book)", hint: "Standalone book, leaf item" },
  { value: "consumable", label: "Consumable (consumable)", hint: "Stationery leaf item" },
  { value: "excluded", label: "Excluded (excluded)", hint: "Hidden from storefront" },
];
const BUNDLE_KINDS: ProductKind[] = ["kit", "magic_box", "sub_bundle"];

type Variant = {
  id?: string;
  size: string;
  sku: string;
  stockQty: number;
};

export function ProductForm({
  product,
  categories,
  variants = [],
  schools = [],
  gradeOptions = [],
}: {
  product?: ProductFields;
  categories: { id: string; label: string; name: string }[];
  variants?: Variant[];
  schools?: { id: string; name: string }[];
  gradeOptions?: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isNew = !product;
  // Create-flow only: multi-select chips for schools + grades, plus the
  // catalog-role taxonomy that drives storefront visibility (Phase 1 fix
  // for products getting hidden when kind was left NULL).
  const [newKind, setNewKind] = useState<ProductKind | "">("");
  const [newSchoolIds, setNewSchoolIds] = useState<string[]>([]);
  const [newGrades, setNewGrades] = useState<string[]>([]);

  const [form, setForm] = useState<ProductFields>(
    product ?? {
      id: "",
      slug: "",
      name: "",
      tagline: "",
      basePrice: 0,
      baseMrp: null,
      categoryId: null,
      status: "draft",
    }
  );
  const [vs, setVs] = useState<Variant[]>(variants);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isNew && !newKind) {
      setError(
        "Pick a Type. Without it, the new item stays hidden from parents."
      );
      return;
    }
    start(async () => {
      const url = isNew
        ? "/api/admin/products"
        : `/api/admin/products/${product!.id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isNew
            ? {
                ...form,
                variants: vs,
                schoolIds: newSchoolIds,
                grades: newGrades,
                kind: newKind || undefined,
              }
            : { ...form, variants: vs }
        ),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      const data = await res.json();
      const nextId = data.product?.id ?? product?.id;
      if (isNew && nextId) router.push(`/admin/products/${nextId}`);
      else router.refresh();
    });
  };

  const remove = () => {
    if (!product || !confirm("Delete this product? Cannot be undone.")) return;
    start(async () => {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: "DELETE",
      });
      if (res.ok) router.push("/admin/products");
    });
  };

  const quickStatus = (next: ProductFields["status"]) => {
    if (!product) {
      // New-product flow — change the dropdown only; user still presses Save.
      setForm((f) => ({ ...f, status: next }));
      return;
    }
    start(async () => {
      setError(null);
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Could not change status");
        return;
      }
      setForm((f) => ({ ...f, status: next }));
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Publish-state banner — instant feedback that this product is (or
          isn't) visible to parents, with a one-click action. Replaces having
          to hunt for the Status select in Basics. */}
      <PublishBanner
        status={form.status}
        isNew={isNew}
        pending={pending}
        onPublish={() => quickStatus("active")}
        onUnpublish={() => quickStatus("draft")}
        onArchive={() => quickStatus("archived")}
      />
      <section className="rounded-2xl border border-ink-100 bg-white p-6 lg:p-8 space-y-5">
        <h2 className="font-display text-[16px] font-bold text-ink-900">
          Basics
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <Input
            label="Slug"
            value={form.slug}
            onChange={(v) =>
              setForm({ ...form, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
            }
            required
          />
          <Input
            label="Tagline"
            value={form.tagline}
            onChange={(v) => setForm({ ...form, tagline: v })}
            className="sm:col-span-2"
          />
          <NumberInput
            label="Base price (₹)"
            value={form.basePrice}
            onChange={(n) =>
              setForm({ ...form, basePrice: typeof n === "number" ? n : 0 })
            }
            required
          />
          <NumberInput
            label="MRP (₹) — optional"
            value={form.baseMrp ?? ""}
            onChange={(n) => setForm({ ...form, baseMrp: n === "" ? null : Number(n) })}
          />
          <label className="flex flex-col">
            <span className="text-[12px] font-semibold text-ink-700">Category</span>
            <select
              value={form.categoryId ?? ""}
              onChange={(e) =>
                setForm({ ...form, categoryId: e.target.value || null })
              }
              className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
            >
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {isNew && (
              <span className="mt-1 text-[11px] text-ink-500 leading-snug">
                Category drives shop nav grouping only. The <b>Type</b> field
                below is what makes parents see this item.
              </span>
            )}
          </label>
          {isNew ? (
            <label className="flex flex-col">
              <span className="text-[12px] font-semibold text-ink-700">
                Type <span className="text-red-500">*</span>
              </span>
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as ProductKind | "")}
                className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
              >
                <option value="">— pick a type —</option>
                {KIND_OPTIONS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              {newKind && (
                <span className="mt-1 text-[11px] text-ink-500 leading-snug">
                  {KIND_OPTIONS.find((k) => k.value === newKind)?.hint}
                  {BUNDLE_KINDS.includes(newKind as ProductKind) &&
                    " · A product_bundles row will be created so you can add BOM children at /admin/boms."}
                </span>
              )}
            </label>
          ) : null}
          <label className="flex flex-col">
            <span className="text-[12px] font-semibold text-ink-700">Status</span>
            <select
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as ProductFields["status"] })
              }
              className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          {isNew && schools.length > 0 ? (
            <div className="flex flex-col sm:col-span-2">
              <span className="text-[12px] font-semibold text-ink-700">
                Schools <span className="text-ink-400 font-normal">(pick one or more)</span>
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {schools.map((s) => {
                  const on = newSchoolIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setNewSchoolIds((cur) =>
                          on ? cur.filter((id) => id !== s.id) : [...cur, s.id]
                        )
                      }
                      className={
                        "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors " +
                        (on
                          ? "border-ink-900 bg-ink-900 text-white"
                          : "border-ink-200 bg-white text-ink-700 hover:border-ink-400")
                      }
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
              <span className="mt-1 text-[11px] text-ink-500 leading-snug">
                One product_school row written per chip selected. Leave empty
                to skip (you can map schools later from the product edit page).
              </span>
            </div>
          ) : null}
          {isNew && gradeOptions.length > 0 ? (
            <div className="flex flex-col sm:col-span-2">
              <span className="text-[12px] font-semibold text-ink-700">
                Grades <span className="text-ink-400 font-normal">(pick one or more)</span>
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {gradeOptions.map((g) => {
                  const on = newGrades.includes(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() =>
                        setNewGrades((cur) =>
                          on ? cur.filter((x) => x !== g) : [...cur, g]
                        )
                      }
                      className={
                        "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors " +
                        (on
                          ? "border-ink-900 bg-ink-900 text-white"
                          : "border-ink-200 bg-white text-ink-700 hover:border-ink-400")
                      }
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
              <span className="mt-1 text-[11px] text-ink-500 leading-snug">
                One product_grades row written per chip. Leave empty to skip.
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {!isNew && (
        <section className="rounded-2xl border border-ink-100 bg-white p-6 lg:p-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-[16px] font-bold text-ink-900">
              Sizes &amp; stock
            </h2>
            <button
              type="button"
              onClick={() =>
                setVs([
                  ...vs,
                  {
                    size: "",
                    sku: `${form.slug.toUpperCase()}-NEW`,
                    stockQty: 0,
                  },
                ])
              }
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand hover:text-brand-700"
            >
              <Plus className="h-3 w-3" /> Add variant
            </button>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500">
                <th className="py-2 pr-3">Size</th>
                <th className="py-2 pr-3">SKU</th>
                <th className="py-2 pr-3 text-right">Stock</th>
                <th className="py-2 pr-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {vs.map((v, i) => (
                <tr key={i} className="border-t border-ink-100">
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      value={v.size}
                      onChange={(e) =>
                        setVs(vs.map((x, j) => (i === j ? { ...x, size: e.target.value } : x)))
                      }
                      className="w-20 rounded-md border border-ink-200 px-2 py-1 text-[13px] outline-none focus:border-ink-900"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      value={v.sku}
                      onChange={(e) =>
                        setVs(vs.map((x, j) => (i === j ? { ...x, sku: e.target.value } : x)))
                      }
                      className="w-44 rounded-md border border-ink-200 px-2 py-1 text-[13px] font-mono outline-none focus:border-ink-900"
                    />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <input
                      type="number"
                      min={0}
                      value={v.stockQty}
                      onChange={(e) =>
                        setVs(
                          vs.map((x, j) =>
                            i === j ? { ...x, stockQty: Number(e.target.value) } : x
                          )
                        )
                      }
                      className="w-20 rounded-md border border-ink-200 px-2 py-1 text-[13px] text-right tabular-nums outline-none focus:border-ink-900"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => setVs(vs.filter((_, j) => j !== i))}
                      className="text-ink-400 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        {!isNew ? (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-red-600 hover:text-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-5 h-10 text-[13px] font-bold hover:bg-brand-600 disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? "Saving…" : "Save product"}
        </button>
      </div>
    </form>
  );
}

function PublishBanner({
  status,
  isNew,
  pending,
  onPublish,
  onUnpublish,
  onArchive,
}: {
  status: ProductFields["status"];
  isNew: boolean;
  pending: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  onArchive: () => void;
}) {
  if (status === "active") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 flex flex-wrap items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-emerald-900">
            Live — visible to customers
          </p>
          <p className="text-[12px] text-emerald-800/80 leading-snug">
            Parents on mapped schools/grades can see this product in their catalog.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onUnpublish}
            disabled={pending || isNew}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 h-8 text-[12px] font-semibold text-ink-800 hover:border-ink-900 disabled:opacity-60"
          >
            <EyeOff className="h-3.5 w-3.5" /> Unpublish to draft
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={pending || isNew}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 h-8 text-[12px] font-semibold text-ink-800 hover:border-ink-900 disabled:opacity-60"
          >
            <Archive className="h-3.5 w-3.5" /> Archive
          </button>
        </div>
      </div>
    );
  }
  if (status === "archived") {
    return (
      <div className="rounded-2xl border border-ink-200 bg-cream-100 px-4 py-3 flex flex-wrap items-center gap-3">
        <Archive className="h-5 w-5 text-ink-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-ink-900">Archived</p>
          <p className="text-[12px] text-ink-600 leading-snug">
            Hidden from the catalog and reports default views. Restore to draft to edit safely.
          </p>
        </div>
        <button
          type="button"
          onClick={onUnpublish}
          disabled={pending || isNew}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 h-8 text-[12px] font-semibold text-ink-800 hover:border-ink-900 disabled:opacity-60"
        >
          Restore to draft
        </button>
      </div>
    );
  }
  // draft
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3 flex flex-wrap items-center gap-3">
      <EyeOff className="h-5 w-5 text-amber-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold text-amber-900">
          Draft — not visible to customers
        </p>
        <p className="text-[12px] text-amber-800/80 leading-snug">
          {isNew
            ? "This product will be saved as a draft. Choose Publish in the banner above after creation to make it live."
            : "Review content, images and variants, then publish to make this product live for mapped customers."}
        </p>
      </div>
      <button
        type="button"
        onClick={onPublish}
        disabled={pending || isNew}
        title={isNew ? "Save first, then publish" : "Make this product live"}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand text-white px-3.5 h-8 text-[12px] font-bold hover:bg-brand-600 disabled:opacity-60"
      >
        <Send className="h-3.5 w-3.5" /> Publish now
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={"flex flex-col " + className}>
      <span className="text-[12px] font-semibold text-ink-700">
        {label} {required && <span className="text-brand">*</span>}
      </span>
      <input
        type="text"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: number | string;
  onChange: (v: number | "") => void;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col">
      <span className="text-[12px] font-semibold text-ink-700">
        {label} {required && <span className="text-brand">*</span>}
      </span>
      <input
        type="number"
        min={0}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] tabular-nums outline-none focus:border-ink-900"
      />
    </label>
  );
}
