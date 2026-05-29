"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, Boxes } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";

type Variant = {
  id?: string;
  size: string;
  sku: string;
  stockQty: number;
  colorValueId: string | null;
  /** Per-variant selling price in paise (editable; saved to item_prices). */
  price: number | null;
};

type ColourOption = { id: string; label: string };

export function ProductVariantsEditor({
  productId,
  slug,
  initial,
  colourOptions,
}: {
  productId: string;
  slug: string;
  initial: Variant[];
  colourOptions: ColourOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [variants, setVariants] = useState<Variant[]>(initial);

  const dirty = () => setSaved(false);

  const update = (i: number, patch: Partial<Variant>) => {
    setVariants(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
    dirty();
  };

  const add = () => {
    const seq = variants.length + 1;
    setVariants([
      ...variants,
      {
        size: "",
        sku: `${slug.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${seq}`,
        stockQty: 0,
        colorValueId: null,
        price: null,
      },
    ]);
    dirty();
  };

  const remove = (i: number) => {
    setVariants(variants.filter((_, idx) => idx !== i));
    dirty();
  };

  const submit = () => {
    setError(null);
    // Client-side validation: size + sku required and unique
    const seen = new Set<string>();
    for (const v of variants) {
      if (!v.size.trim() || !v.sku.trim()) {
        setError("Every variant needs a size and a SKU");
        return;
      }
      if (seen.has(v.sku)) {
        setError(`Duplicate SKU "${v.sku}"`);
        return;
      }
      seen.add(v.sku);
    }
    start(async () => {
      const res = await fetch(`/api/admin/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants }),
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
    <Card>
      <CardHeader
        title="Variants"
        description="Each row is one size/SKU combination. Stock here is the legacy column; for the live bin balance use the Stock page."
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={add}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Add variant
          </Button>
        }
      />

      {variants.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No variants yet"
          description="Add the sizes you sell, give each a unique SKU, and customers will see them in the buy box."
        />
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[640px]">
          <thead>
            <tr className="text-left text-[10px] font-semibold tracking-wider uppercase text-ink-500">
              <th className="py-2 pr-3">Colour</th>
              <th className="py-2 pr-3">Size</th>
              <th className="py-2 pr-3">SKU</th>
              <th className="py-2 pr-3 text-right">Price (₹)</th>
              <th className="py-2 pr-3 text-right">Legacy stock</th>
              <th className="py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => (
              <tr key={v.id ?? `new-${i}`} className="border-t border-ink-100">
                <td className="py-1.5 pr-3">
                  {colourOptions.length > 0 ? (
                    <select
                      value={v.colorValueId ?? ""}
                      onChange={(e) =>
                        update(i, { colorValueId: e.target.value || null })
                      }
                      className="w-40 rounded-md border border-ink-200 px-2 py-1 text-[13px] bg-white outline-none focus:border-ink-900"
                    >
                      <option value="">—</option>
                      {colourOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="text"
                    value={v.size}
                    onChange={(e) => update(i, { size: e.target.value })}
                    className="w-24 rounded-md border border-ink-200 px-2 py-1 text-[13px] outline-none focus:border-ink-900"
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="text"
                    value={v.sku}
                    onChange={(e) => update(i, { sku: e.target.value })}
                    className="w-56 rounded-md border border-ink-200 px-2 py-1 text-[13px] font-mono outline-none focus:border-ink-900"
                  />
                </td>
                <td className="py-1.5 pr-3 text-right">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={v.price != null ? v.price / 100 : ""}
                    placeholder="₹"
                    onChange={(e) => {
                      const r = e.target.value;
                      update(i, {
                        price:
                          r === "" ? null : Math.round(parseFloat(r) * 100),
                      });
                    }}
                    className="w-28 rounded-md border border-ink-200 px-2 py-1 text-[13px] text-right tabular-nums outline-none focus:border-ink-900"
                  />
                </td>
                <td className="py-1.5 pr-3 text-right">
                  <input
                    type="number"
                    min={0}
                    value={v.stockQty}
                    onChange={(e) =>
                      update(i, { stockQty: parseInt(e.target.value, 10) || 0 })
                    }
                    className="w-24 rounded-md border border-ink-200 px-2 py-1 text-[13px] text-right tabular-nums outline-none focus:border-ink-900"
                  />
                </td>
                <td className="py-1.5">
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="grid place-items-center h-7 w-7 rounded-md text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-ink-100/60">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        {saved ? <span className="text-[13px] text-emerald-700">✓ Saved</span> : null}
        <Button
          type="button"
          busy={pending}
          onClick={submit}
          icon={<Save className="h-3.5 w-3.5" />}
        >
          Save variants
        </Button>
      </div>
    </Card>
  );
}
