"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Product = {
  id: string;
  name: string;
  itemCode: string | null;
  categoryId: string | null;
  basePrice: number | null;
  costPrice: number | null;
};

export function BulkMarkupForm({
  products,
  priceLists,
  schools,
  categories,
}: {
  products: Product[];
  priceLists: { id: string; name: string; isDefault: boolean }[];
  schools: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const defaultList = priceLists.find((l) => l.isDefault) ?? priceLists[0];
  const [priceListId, setPriceListId] = useState(defaultList?.id ?? "");
  const [schoolId, setSchoolId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [markup, setMarkup] = useState("20");
  const [pickAll, setPickAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    if (!categoryId) return products;
    return products.filter((p) => p.categoryId === categoryId);
  }, [products, categoryId]);

  const togglePick = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    setPickAll(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const ids = pickAll ? filtered.map((p) => p.id) : Array.from(picked);
    if (ids.length === 0) {
      setError("Pick at least one product");
      return;
    }
    if (!priceListId) {
      setError("Pick a price list");
      return;
    }
    const m = Number(markup);
    if (!Number.isFinite(m)) {
      setError("Markup must be a number");
      return;
    }
    if (
      !confirm(
        `Apply ${m}% markup to ${ids.length} product${ids.length === 1 ? "" : "s"} on "${
          priceLists.find((l) => l.id === priceListId)?.name
        }"${schoolId ? " (school-specific)" : ""}?`
      )
    )
      return;
    start(async () => {
      const r = await fetch("/api/admin/item-prices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: ids,
          markupPercent: m,
          priceListId,
          schoolId: schoolId || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Bulk markup failed");
        return;
      }
      const data = await r.json();
      setResult(`Updated ${data.updated} variant prices.`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Field label="Price list" required>
          <select
            value={priceListId}
            onChange={(e) => setPriceListId(e.target.value)}
            required
            className={inputClass}
          >
            <option value="">— Pick price list —</option>
            {priceLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="School scope" hint="Leave global to apply to all schools">
          <select
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            className={inputClass}
          >
            <option value="">Global</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Markup %" required hint="Over cost price (or base if cost unset)">
          <input
            type="number"
            step="0.5"
            value={markup}
            onChange={(e) => setMarkup(e.target.value)}
            required
            className={inputClass}
          />
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-semibold text-ink-900">Products</h3>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={inputClass + " max-w-[220px]"}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-[13px] mb-2">
          <input
            type="checkbox"
            checked={pickAll}
            onChange={(e) => {
              setPickAll(e.target.checked);
              if (e.target.checked) setPicked(new Set());
            }}
            className="h-4 w-4"
          />
          <span className="font-semibold">
            Apply to all {filtered.length} {categoryId ? "filtered" : ""} products
          </span>
        </label>
        {!pickAll ? (
          <div className="border border-ink-100/70 rounded-xl max-h-72 overflow-y-auto bg-cream-50/40">
            {filtered.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-white border-b border-ink-100/50 last:border-0 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={picked.has(p.id)}
                  onChange={() => togglePick(p.id)}
                  className="h-4 w-4"
                />
                <span className="flex-1">{p.name}</span>
                {p.itemCode ? (
                  <span className="font-mono text-[11px] text-ink-500">
                    {p.itemCode}
                  </span>
                ) : null}
                <span className="text-[11px] text-ink-500 tabular-nums w-20 text-right">
                  cost: ₹{p.costPrice != null ? (p.costPrice / 100).toFixed(2) : "—"}
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-ink-100/70">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        {result ? <span className="text-[13px] text-emerald-700">{result}</span> : null}
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Apply markup
        </Button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      {hint ? <span className="text-[11px] text-ink-500 ml-2">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
