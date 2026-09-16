"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, Boxes, X, Grid3x3 } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";
import { VariantGenerator, type AttributeOption, type GeneratedRow } from "@/components/admin/products/VariantGenerator";

type Variant = {
  id?: string;
  size: string;
  sku: string;
  /** Kept for the save payload only — stock is managed under Stock, not here. */
  stockQty: number;
  colorValueId: string | null;
  /** Customer-facing visibility. Off = hidden from the storefront picker
   *  (the variant + its history stay intact and can be turned back On). */
  isActive: boolean;
  /** Per-variant selling price in paise (editable; saved to item_prices). */
  price: number | null;
  /** True once the admin has typed into the price field (or pressed Clear).
   *  Untouched rows are sent without a `price` key so the server leaves the
   *  existing item_prices row alone — blank inputs no longer wipe prices. */
  priceTouched?: boolean;
  /** True when the admin explicitly clicked Clear. Sends `price: null` so
   *  the server deletes the item_prices row. */
  priceCleared?: boolean;
};

type ColourOption = { id: string; label: string };

export function ProductVariantsEditor({
  productId,
  slug,
  initial,
  colourOptions,
  attributeOptions = [],
  stockByVariant = {},
}: {
  productId: string;
  slug: string;
  initial: Variant[];
  colourOptions: ColourOption[];
  /** Size + colour attributes for the "Generate" matrix. Optional. */
  attributeOptions?: AttributeOption[];
  /** On-hand per variant id from the Ground Stock bins. Read-only here —
   *  the admin maps items, the audit ERP counts them. */
  stockByVariant?: Record<string, number | null>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [variants, setVariants] = useState<Variant[]>(initial);
  const [genOpen, setGenOpen] = useState(false);
  const [bySizeOpen, setBySizeOpen] = useState(false);
  const [bySize, setBySize] = useState<Record<string, string>>({});
  const distinctSizes = [...new Set(variants.map((v) => v.size.trim()).filter(Boolean))];

  // "Set price by size": one price per size, copied onto every colour of
  // that size. The common case for uniforms — a 32 costs the same in white
  // and in blue — without typing it once per row.
  const applyBySize = () => {
    setVariants(
      variants.map((v) => {
        const raw = bySize[v.size.trim()];
        if (raw === undefined || raw === "") return v;
        return { ...v, price: Math.round(parseFloat(raw) * 100), priceTouched: true, priceCleared: false };
      }),
    );
    setBySizeOpen(false);
    dirty();
  };

  const dirty = () => setSaved(false);

  const update = (i: number, patch: Partial<Variant>) => {
    setVariants(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
    dirty();
  };

  // Auto-SKU helpers. The `product_variants.sku` column has a GLOBAL
  // unique constraint, so a multi-colour product like the sport polo
  // cannot share an SKU like "SPORT-POLO-T-SHIRT-24" across green / red /
  // white rows — each Colour × Size combination needs its own code. We
  // suggest "<SLUG>-<COLOUR>-<SIZE>" automatically. The autoSku flows
  // through the same input, so the admin can still override by typing.
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const colourLabelById = (id: string | null): string => {
    if (!id) return "";
    const o = colourOptions.find((c) => c.id === id);
    return o?.label ?? "";
  };
  const autoSku = (colorValueId: string | null, size: string): string => {
    const slugPart = norm(slug);
    // Colour label may be "blue (B)" — take only the bare value before the
    // parenthesis so the SKU stays compact.
    const bareColour = colourLabelById(colorValueId).split(" (")[0].trim();
    const parts = [slugPart, norm(bareColour), norm(size)].filter(Boolean);
    return parts.join("-");
  };

  // Update colour or size and roll the SKU forward when it still matches
  // what we'd have suggested before. If the admin has typed a custom SKU,
  // we leave it alone.
  const updateColour = (i: number, newColorValueId: string | null) => {
    const v = variants[i];
    const prevAuto = autoSku(v.colorValueId, v.size);
    const nextAuto = autoSku(newColorValueId, v.size);
    const sku = !v.sku || v.sku === prevAuto ? nextAuto : v.sku;
    update(i, { colorValueId: newColorValueId, sku });
  };
  const updateSize = (i: number, newSize: string) => {
    const v = variants[i];
    const prevAuto = autoSku(v.colorValueId, v.size);
    const nextAuto = autoSku(v.colorValueId, newSize);
    const sku = !v.sku || v.sku === prevAuto ? nextAuto : v.sku;
    update(i, { size: newSize, sku });
  };

  const add = () => {
    // Start with an empty SKU; it will auto-fill when the admin sets
    // colour and size. Falling back to a slug-sequence number invited
    // the admin to hand-edit it into a colliding pattern.
    setVariants([
      ...variants,
      {
        size: "",
        sku: "",
        stockQty: 0,
        colorValueId: null,
        price: null,
        isActive: true,
      },
    ]);
    dirty();
  };

  const remove = (i: number) => {
    setVariants(variants.filter((_, idx) => idx !== i));
    dirty();
  };

  // Rows from the colour × size generator. Blank starter rows are dropped
  // so "Add variant, then Generate" doesn't leave an empty line behind.
  const appendGenerated = (rows: GeneratedRow[]) => {
    const kept = variants.filter((v) => v.size.trim() || v.sku.trim());
    setVariants([
      ...kept,
      ...rows.map((r) => ({
        size: r.size,
        sku: autoSku(r.colorValueId, r.size),
        stockQty: 0,
        colorValueId: r.colorValueId,
        price: null,
        isActive: true,
      })),
    ]);
    dirty();
  };
  const existingKeys = new Set(variants.map((v) => `${v.colorValueId ?? ""}|${v.size.trim()}`));

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
    // Strip per-row UI flags and OMIT `price` for rows the admin hasn't
    // touched — the server uses `v.price !== undefined` to decide whether to
    // upsert/delete the item_prices row. Without this, a blank input on an
    // unrelated row would silently wipe its saved price.
    const payload = variants.map((v) => {
      const base = {
        id: v.id,
        size: v.size,
        sku: v.sku,
        stockQty: v.stockQty,
        colorValueId: v.colorValueId,
        isActive: v.isActive,
      };
      if (!v.priceTouched) return base;
      return { ...base, price: v.priceCleared ? null : v.price };
    });
    start(async () => {
      const res = await fetch(`/api/admin/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants: payload }),
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
        description="One row per size (and colour). Each needs its own SKU; a price here overrides the base price for that size."
        actions={
          <div className="flex items-center gap-2">
            {attributeOptions.some((a) => a.type === "size" && a.values.length) ? (
              <Button type="button" size="sm" variant="primary" onClick={() => setGenOpen(true)} icon={<Grid3x3 className="h-3.5 w-3.5" />}>
                Generate colour × size
              </Button>
            ) : null}
            {distinctSizes.length > 1 ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setBySizeOpen(true)}>
                Set price by size
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={add}
              icon={<Plus className="h-3.5 w-3.5" />}
            >
              Add one
            </Button>
          </div>
        }
      />
      <VariantGenerator open={genOpen} onClose={() => setGenOpen(false)} attributes={attributeOptions} existing={existingKeys} onGenerate={appendGenerated} />
      {bySizeOpen ? (
        <div className="mb-4 rounded-xl border border-ink-100/70 bg-cream-50/60 p-4">
          <div className="mb-2 text-[12.5px] font-semibold text-ink-800">Price per size <span className="font-normal text-ink-500">— applied to every colour of that size. Leave a size blank to keep its prices.</span></div>
          <div className="flex flex-wrap gap-3">
            {distinctSizes.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-[12.5px]">
                <span className="w-10 text-right font-medium text-ink-700">{s}</span>
                <span className="text-ink-400">₹</span>
                <input type="number" min={0} step="0.01" value={bySize[s] ?? ""} onChange={(e) => setBySize({ ...bySize, [s]: e.target.value })} className="h-8 w-24 rounded-md border border-ink-200 px-2 text-right tabular-nums outline-none focus:border-ink-900" />
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setBySizeOpen(false)}>Cancel</Button>
            <Button type="button" size="sm" onClick={applyBySize}>Apply to rows</Button>
          </div>
        </div>
      ) : null}

      {variants.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No variants yet"
          description="Generate every colour × size in one go, or add sizes one at a time. Customers pick from these in the buy box."
        />
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[520px]">
          <thead>
            <tr className="text-left text-[10px] font-semibold tracking-wider uppercase text-ink-500 border-b border-ink-100">
              <th className="py-1.5 pr-2 w-12">Shown</th>
              <th className="py-1.5 pr-2">Colour</th>
              <th className="py-1.5 pr-2">Size</th>
              <th className="py-1.5 pr-2">SKU</th>
              <th className="py-1.5 pr-2 text-right">Price (₹)</th>
              <th className="py-1.5 pr-2 text-right" title="From the Ground Stock bins — read-only">Stock</th>
              <th className="py-1.5 w-7"></th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => {
              // Live warning when the typed size looks like "<colour> · <size>"
              // — admins kept doing this on the sport-polo product because the
              // input had no guidance. Server strips this on save too.
              const looksPolluted =
                /\s*[·\-–—]\s*/.test(v.size) && v.colorValueId !== null;
              return (
                <tr
                  key={v.id ?? `new-${i}`}
                  className={
                    "border-t border-ink-100/70 " +
                    (v.isActive ? "" : "bg-ink-50/60")
                  }
                >
                  <td className="py-1 pr-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={v.isActive}
                      title={
                        v.isActive
                          ? "Shown to customers — click to hide"
                          : "Hidden from customers — click to show"
                      }
                      onClick={() => update(i, { isActive: !v.isActive })}
                      className={
                        "relative inline-flex h-4 w-7 items-center rounded-full transition-colors " +
                        (v.isActive ? "bg-emerald-500" : "bg-ink-300")
                      }
                    >
                      <span
                        className={
                          "inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform " +
                          (v.isActive ? "translate-x-3.5" : "translate-x-0.5")
                        }
                      />
                    </button>
                  </td>
                  <td className="py-1 pr-2">
                    {colourOptions.length > 0 ? (
                      <select
                        value={v.colorValueId ?? ""}
                        onChange={(e) =>
                          updateColour(i, e.target.value || null)
                        }
                        className="h-8 w-36 rounded-md border border-ink-200 bg-white px-2 text-[12.5px] outline-none focus:border-ink-900"
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
                  <td className="py-1 pr-2">
                    <div className="flex flex-col gap-0.5">
                      <input
                        type="text"
                        value={v.size}
                        placeholder="e.g. 24, S, M, L"
                        onChange={(e) => updateSize(i, e.target.value)}
                        className={
                          "h-8 w-20 rounded-md border px-2 text-[12.5px] outline-none " +
                          (looksPolluted
                            ? "border-amber-400 focus:border-amber-600 bg-amber-50"
                            : "border-ink-200 focus:border-ink-900")
                        }
                      />
                      {looksPolluted ? (
                        <span className="text-[10px] text-amber-700 leading-tight">
                          Looks like the colour is in here. Enter just the size — colour is picked above.
                        </span>
                      ) : null}
                    </div>
                  </td>
                <td className="py-1 pr-2">
                  <input
                    type="text"
                    value={v.sku}
                    onChange={(e) => update(i, { sku: e.target.value })}
                    className="h-8 w-full min-w-[160px] max-w-[280px] rounded-md border border-ink-200 px-2 font-mono text-[12.5px] outline-none focus:border-ink-900"
                  />
                </td>
                <td className="py-1 pr-2 text-right">
                  <div className="inline-flex items-center justify-end gap-1">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={
                        v.priceCleared
                          ? ""
                          : v.price != null
                            ? v.price / 100
                            : ""
                      }
                      placeholder={v.price != null && !v.priceTouched ? "(saved)" : "₹"}
                      onChange={(e) => {
                        const r = e.target.value;
                        update(i, {
                          price:
                            r === "" ? null : Math.round(parseFloat(r) * 100),
                          priceTouched: true,
                          priceCleared: false,
                        });
                      }}
                      className="h-8 w-24 rounded-md border border-ink-200 px-2 text-right text-[12.5px] tabular-nums outline-none focus:border-ink-900"
                    />
                    {(v.price != null || v.priceTouched) && !v.priceCleared && (
                      <button
                        type="button"
                        onClick={() =>
                          update(i, {
                            price: null,
                            priceTouched: true,
                            priceCleared: true,
                          })
                        }
                        title="Clear price (variant will fall back to base price)"
                        className="grid place-items-center h-6 w-6 rounded text-ink-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {v.price == null && !v.priceCleared && (
                    <div className="mt-0.5 flex justify-end">
                      <span className="inline-flex items-center rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
                        Missing price
                      </span>
                    </div>
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {v.id && stockByVariant[v.id] != null ? (
                    <span className={stockByVariant[v.id]! > 0 ? "text-ink-800" : "font-semibold text-red-700"}>{stockByVariant[v.id]}</span>
                  ) : (
                    <span className="text-ink-300" title={v.id ? "No count yet" : "Save first"}>—</span>
                  )}
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="grid h-7 w-7 place-items-center rounded-md text-ink-300 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  </td>
                </tr>
              );
            })}
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
