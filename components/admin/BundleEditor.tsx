"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Eye, EyeOff, Minus, Package, Layers } from "lucide-react";
import { Button, IconBtn } from "@/components/admin/ui/primitives-client";
import { Input, Select, Checkbox, FormError } from "@/components/admin/ui/form";
import { ProductPicker, type PickedProduct } from "@/components/admin/bundles/ProductPicker";
import { cn } from "@/lib/cn";

export type ComponentRow = {
  id?: string;
  variantId: string | null;
  productId: string | null;
  qty: number;
  selectorGroupKey: string | null;
  selectorOptionLabel: string | null;
  isOptional: boolean;
  isVisible: boolean;
  /** Resolved on the server for existing rows, from the picker for new ones. */
  product: PickedProduct | null;
  /** True when the component's product is itself a bundle — it expands. */
  isBundle?: boolean;
  bundleId?: string | null;
};

type Selector = {
  id?: string;
  groupKey: string;
  name: string;
  selectorType: "one_of" | "multi";
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  sortOrder: number;
};

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function BundleEditor({
  bundleId,
  ownProductId,
  bundleType,
  pricingMode,
  fixedPrice,
  readOnly = false,
  initialComponents,
  initialSelectors,
}: {
  bundleId: string;
  ownProductId: string;
  bundleType: "fixed" | "configurable";
  pricingMode: "sum" | "fixed";
  fixedPrice: number | null;
  readOnly?: boolean;
  initialComponents: ComponentRow[];
  initialSelectors: Selector[];
}) {
  const router = useRouter();
  const [components, setComponents] = useState<ComponentRow[]>(initialComponents);
  const [selectors, setSelectors] = useState<Selector[]>(initialSelectors);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty = useMemo(() => {
    const strip = (c: ComponentRow) => [c.productId, c.variantId, c.qty, c.isVisible, c.isOptional, c.selectorGroupKey ?? "", c.selectorOptionLabel ?? ""].join("|");
    const a = components.map(strip).join("\n");
    const b = initialComponents.map(strip).join("\n");
    const s = (x: Selector) => [x.groupKey, x.name, x.selectorType, x.isRequired, x.minSelections, x.maxSelections ?? "", x.sortOrder].join("|");
    return a !== b || selectors.map(s).join("\n") !== initialSelectors.map(s).join("\n");
  }, [components, selectors, initialComponents, initialSelectors]);

  const sum = components.reduce((acc, c) => acc + (c.product ? c.product.basePrice * c.qty : 0), 0);
  const units = components.reduce((acc, c) => acc + c.qty, 0);
  const hidden = components.filter((c) => !c.isVisible).length;
  const excludeIds = useMemo(() => [ownProductId, ...components.map((c) => c.productId).filter((x): x is string => !!x)], [ownProductId, components]);

  function patch(idx: number, p: Partial<ComponentRow>) {
    setComponents((prev) => prev.map((c, i) => (i === idx ? { ...c, ...p } : c)));
  }
  function remove(idx: number) {
    setComponents((prev) => prev.filter((_, i) => i !== idx));
  }
  function add(p: PickedProduct) {
    setComponents((prev) => [
      ...prev,
      {
        productId: p.id,
        // A single-size product binds straight to that variant; otherwise the
        // row starts at "any size" and the admin narrows it.
        variantId: p.variants.length === 1 ? p.variants[0]!.id : null,
        qty: 1,
        selectorGroupKey: null,
        selectorOptionLabel: null,
        isOptional: false,
        isVisible: true,
        product: p,
      },
    ]);
  }

  function save() {
    setError(null);
    start(async () => {
      const r = await fetch(`/api/admin/bundles/${bundleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          components: components.map((c) => ({
            variantId: c.variantId || null,
            productId: c.productId || null,
            qty: c.qty,
            selectorGroupKey: c.selectorGroupKey || null,
            selectorOptionLabel: c.selectorOptionLabel || null,
            isOptional: c.isOptional,
            isVisible: c.isVisible,
          })),
          ...(bundleType === "configurable"
            ? {
                selectors: selectors.map((s) => ({
                  groupKey: s.groupKey,
                  name: s.name,
                  selectorType: s.selectorType,
                  isRequired: s.isRequired,
                  minSelections: s.minSelections,
                  maxSelections: s.maxSelections,
                  sortOrder: s.sortOrder,
                })),
              }
            : {}),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      router.refresh();
    });
  }

  function discard() {
    setComponents(initialComponents);
    setSelectors(initialSelectors);
    setError(null);
  }

  return (
    <div className="space-y-6">
      {error ? <FormError>{error}</FormError> : null}

      {/* ── Components ── */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-[14px] font-semibold text-ink-900">
            Components{" "}
            <span className="text-[12px] font-normal text-ink-500">
              {components.length ? `${components.length} line${components.length === 1 ? "" : "s"} · ${units} unit${units === 1 ? "" : "s"}${hidden ? ` · ${hidden} hidden` : ""}` : "none yet"}
            </span>
          </h3>
          <span className="text-[12px] text-ink-500">
            {pricingMode === "fixed" && fixedPrice != null ? (
              <>Sells at <span className="font-semibold text-ink-800">{rupees(fixedPrice)}</span> · components add up to {rupees(sum)}</>
            ) : (
              <>Price is the sum of components: <span className="font-semibold text-ink-800">{rupees(sum)}</span></>
            )}
          </span>
        </div>

        {!readOnly ? (
          <ProductPicker onPick={add} exclude={excludeIds} className="mb-3" placeholder="Add a component — search by name or item code…" />
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-ink-100/70">
          <table className="w-full text-[13px]">
            <thead className="bg-cream-50/60 text-[11px] uppercase tracking-[0.08em] text-ink-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="w-44 px-2 py-2 text-left font-semibold">Size</th>
                <th className="w-28 px-2 py-2 text-center font-semibold">Qty</th>
                <th className="w-24 px-2 py-2 text-right font-semibold">Line</th>
                {bundleType === "configurable" ? <th className="w-40 px-2 py-2 text-left font-semibold">Choice group</th> : null}
                <th className="w-20 px-2 py-2 text-center font-semibold">Shown</th>
                {!readOnly ? <th className="w-10 px-2 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {components.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[13px] text-ink-500">
                    {readOnly ? "This bundle has no components." : "Nothing in this bundle yet — search above to add the first item."}
                  </td>
                </tr>
              ) : null}
              {components.map((c, i) => {
                const p = c.product;
                const variant = p?.variants.find((v) => v.id === c.variantId) ?? null;
                return (
                  <tr key={c.id ?? `new-${i}`} className={cn("border-t border-ink-100/70", !c.isVisible && "bg-cream-50/50")}>
                    <td className="px-3 py-2">
                      {p ? (
                        <div className="flex items-center gap-2.5">
                          <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", c.isBundle ? "bg-violet-50 text-violet-700" : "bg-cream-100 text-ink-500")}>
                            {c.isBundle ? <Layers className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0">
                            {c.isBundle && c.bundleId ? (
                              <Link href={`/admin/catalog/bundles/${c.bundleId}`} className={cn("block truncate font-medium hover:text-brand-700", c.isVisible ? "text-ink-900" : "text-ink-500")}>
                                {p.name}
                              </Link>
                            ) : (
                              <span className={cn("block truncate font-medium", c.isVisible ? "text-ink-900" : "text-ink-500")}>{p.name}</span>
                            )}
                            <span className="block truncate text-[11.5px] text-ink-500">
                              {p.itemCode ? <span className="font-mono">{p.itemCode}</span> : null}
                              {p.itemCode ? " · " : ""}
                              {rupees(p.basePrice)}
                              {c.isBundle ? <span className="ml-1.5 rounded bg-violet-50 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-700">bundle</span> : null}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <span className="text-[12.5px] italic text-ink-400">Unlinked component</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {p && p.variants.length > 0 ? (
                        <Select selectSize="sm" value={c.variantId ?? ""} disabled={readOnly} onChange={(e) => patch(i, { variantId: e.target.value || null })}>
                          <option value="">Any size</option>
                          {p.variants.map((v) => (
                            <option key={v.id} value={v.id}>{v.size}{v.sku ? ` · ${v.sku}` : ""}</option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-[12px] text-ink-400">{variant ? variant.size : "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-center gap-1">
                        {!readOnly ? <IconBtn size="sm" label="Less" icon={<Minus className="h-3 w-3" />} disabled={c.qty <= 1} onClick={() => patch(i, { qty: Math.max(1, c.qty - 1) })} /> : null}
                        <Input
                          inputSize="sm"
                          type="number"
                          min={1}
                          value={c.qty}
                          disabled={readOnly}
                          onChange={(e) => patch(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                          className="w-14 text-center"
                        />
                        {!readOnly ? <IconBtn size="sm" label="More" icon={<Plus className="h-3 w-3" />} onClick={() => patch(i, { qty: c.qty + 1 })} /> : null}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-700">{p ? rupees(p.basePrice * c.qty) : "—"}</td>
                    {bundleType === "configurable" ? (
                      <td className="px-2 py-2">
                        <Select selectSize="sm" value={c.selectorGroupKey ?? ""} disabled={readOnly} onChange={(e) => patch(i, { selectorGroupKey: e.target.value || null })}>
                          <option value="">Always included</option>
                          {selectors.map((s) => (
                            <option key={s.groupKey} value={s.groupKey}>{s.name || s.groupKey}</option>
                          ))}
                        </Select>
                      </td>
                    ) : null}
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => patch(i, { isVisible: !c.isVisible })}
                        title={c.isVisible ? "Shown on the storefront — click to hide" : "Hidden from the storefront — click to show"}
                        className={cn("rounded-md p-1.5 transition-colors", c.isVisible ? "text-emerald-600 hover:bg-emerald-50" : "text-ink-300 hover:bg-cream-100 hover:text-ink-500")}
                      >
                        {c.isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                    </td>
                    {!readOnly ? (
                      <td className="px-2 py-2 text-right">
                        <IconBtn size="sm" tone="danger" label="Remove" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove(i)} />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-ink-500">
          “Any size” lets the parent choose at checkout. Hidden lines still ship and still count toward the price; they just don&rsquo;t appear in the box contents on the storefront.
        </p>
      </section>

      {/* ── Selectors (configurable bundles only) ── */}
      {bundleType === "configurable" ? (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-ink-900">
              Choice groups <span className="text-[12px] font-normal text-ink-500">what the parent picks — e.g. Language, Second Language</span>
            </h3>
            {!readOnly ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() =>
                  setSelectors((prev) => [
                    ...prev,
                    { groupKey: `group_${prev.length + 1}`, name: "", selectorType: "one_of", isRequired: true, minSelections: 1, maxSelections: null, sortOrder: prev.length },
                  ])
                }
              >
                Add group
              </Button>
            ) : null}
          </div>
          {selectors.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-[12.5px] text-ink-500">
              No choice groups. Every component is always included.
            </div>
          ) : (
            <div className="space-y-2">
              {selectors.map((s, i) => (
                <div key={s.id ?? `sel-${i}`} className="grid grid-cols-12 items-end gap-2 rounded-xl border border-ink-100/70 bg-cream-50/40 p-3">
                  <label className="col-span-3 block">
                    <span className="text-[11px] font-semibold text-ink-700">Key</span>
                    <Input inputSize="sm" className="mt-1 font-mono" value={s.groupKey} disabled={readOnly} onChange={(e) => setSelectors((p) => p.map((x, j) => (j === i ? { ...x, groupKey: e.target.value } : x)))} />
                  </label>
                  <label className="col-span-4 block">
                    <span className="text-[11px] font-semibold text-ink-700">Shown as</span>
                    <Input inputSize="sm" className="mt-1" value={s.name} disabled={readOnly} placeholder="e.g. Second language" onChange={(e) => setSelectors((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  </label>
                  <label className="col-span-2 block">
                    <span className="text-[11px] font-semibold text-ink-700">Pick</span>
                    <Select selectSize="sm" className="mt-1" value={s.selectorType} disabled={readOnly} onChange={(e) => setSelectors((p) => p.map((x, j) => (j === i ? { ...x, selectorType: e.target.value as "one_of" | "multi" } : x)))}>
                      <option value="one_of">One</option>
                      <option value="multi">Many</option>
                    </Select>
                  </label>
                  <div className="col-span-2 pb-1.5">
                    <Checkbox checked={s.isRequired} disabled={readOnly} label="Required" onChange={(e) => setSelectors((p) => p.map((x, j) => (j === i ? { ...x, isRequired: e.target.checked } : x)))} />
                  </div>
                  {!readOnly ? (
                    <div className="col-span-1 flex justify-end pb-0.5">
                      <IconBtn size="sm" tone="danger" label="Remove group" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setSelectors((p) => p.filter((_, j) => j !== i))} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!readOnly ? (
        <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-between gap-3 rounded-b-2xl border-t border-ink-100/70 bg-white/95 px-5 py-3 backdrop-blur lg:-mx-6 lg:-mb-6 lg:px-6">
          <span className={cn("text-[12px]", dirty ? "font-medium text-amber-800" : "text-ink-400")}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <div className="flex items-center gap-2">
            {dirty ? (
              <Button variant="ghost" size="sm" onClick={discard} disabled={pending}>Discard</Button>
            ) : null}
            <Button busy={pending} variant="primary" onClick={save} disabled={!dirty}>Save bundle</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
