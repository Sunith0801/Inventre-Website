"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Component = {
  id?: string;
  variantId: string | null;
  productId: string | null;
  qty: number;
  selectorGroupKey: string | null;
  selectorOptionLabel: string | null;
  isOptional: boolean;
  isVisible: boolean;
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

export function BundleEditor({
  bundleId,
  bundleType,
  initialComponents,
  initialSelectors,
  products,
  variants,
}: {
  bundleId: string;
  bundleType: "fixed" | "configurable";
  initialComponents: Component[];
  initialSelectors: Selector[];
  products: { id: string; name: string; itemCode: string | null }[];
  variants: {
    id: string;
    size: string;
    sku: string;
    productId: string;
  }[];
}) {
  const router = useRouter();
  const [components, setComponents] = useState<Component[]>(initialComponents);
  const [selectors, setSelectors] = useState<Selector[]>(initialSelectors);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const productById = new Map(products.map((p) => [p.id, p]));
  const variantsByProduct = new Map<string, typeof variants>();
  for (const v of variants) {
    const arr = variantsByProduct.get(v.productId) ?? [];
    arr.push(v);
    variantsByProduct.set(v.productId, arr);
  }

  const addComponent = () => {
    setComponents([
      ...components,
      {
        variantId: null,
        productId: null,
        qty: 1,
        selectorGroupKey: null,
        selectorOptionLabel: null,
        isOptional: false,
        isVisible: true,
      },
    ]);
  };

  const updateComponent = (idx: number, patch: Partial<Component>) => {
    setComponents(components.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const removeComponent = (idx: number) => {
    setComponents(components.filter((_, i) => i !== idx));
  };

  const addSelector = () => {
    setSelectors([
      ...selectors,
      {
        groupKey: `group_${selectors.length + 1}`,
        name: "",
        selectorType: "one_of",
        isRequired: true,
        minSelections: 1,
        maxSelections: null,
        sortOrder: selectors.length,
      },
    ]);
  };

  const updateSelector = (idx: number, patch: Partial<Selector>) => {
    setSelectors(selectors.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeSelector = (idx: number) => {
    setSelectors(selectors.filter((_, i) => i !== idx));
  };

  const save = () => {
    setError(null);
    setSaved(false);
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
          selectors: selectors.map((s) => ({
            groupKey: s.groupKey,
            name: s.name,
            selectorType: s.selectorType,
            isRequired: s.isRequired,
            minSelections: s.minSelections,
            maxSelections: s.maxSelections,
            sortOrder: s.sortOrder,
          })),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="space-y-8">
      {/* Components */}
      <section>
        <header className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-[14px] font-semibold text-ink-900">Components</h3>
            <p className="text-[12px] text-ink-500 mt-0.5">
              Variants or products that ship as part of this bundle.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={addComponent}
          >
            Add component
          </Button>
        </header>

        {components.length === 0 ? (
          <div className="text-[13px] text-ink-500 italic py-2">
            No components yet.
          </div>
        ) : (
          <div className="space-y-2">
            {components.map((c, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 gap-2 items-end border border-ink-100/70 rounded-xl p-3 bg-cream-50/40"
              >
                <div className="col-span-5">
                  <label className="text-[11px] font-semibold text-ink-700">Product</label>
                  <select
                    value={c.productId ?? ""}
                    onChange={(e) =>
                      updateComponent(idx, {
                        productId: e.target.value || null,
                        variantId: null,
                      })
                    }
                    className={inputClass + " mt-1"}
                  >
                    <option value="">— Pick product —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="text-[11px] font-semibold text-ink-700">Variant</label>
                  <select
                    value={c.variantId ?? ""}
                    onChange={(e) =>
                      updateComponent(idx, { variantId: e.target.value || null })
                    }
                    className={inputClass + " mt-1"}
                    disabled={!c.productId}
                  >
                    <option value="">Any / parent only</option>
                    {(c.productId
                      ? variantsByProduct.get(c.productId) ?? []
                      : []
                    ).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.size} ({v.sku})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1">
                  <label className="text-[11px] font-semibold text-ink-700">Qty</label>
                  <input
                    type="number"
                    min={1}
                    value={c.qty}
                    onChange={(e) =>
                      updateComponent(idx, { qty: Math.max(1, Number(e.target.value)) })
                    }
                    className={inputClass + " mt-1 text-right"}
                  />
                </div>
                {bundleType === "configurable" ? (
                  <div className="col-span-2">
                    <label className="text-[11px] font-semibold text-ink-700">
                      Selector group
                    </label>
                    <select
                      value={c.selectorGroupKey ?? ""}
                      onChange={(e) =>
                        updateComponent(idx, {
                          selectorGroupKey: e.target.value || null,
                        })
                      }
                      className={inputClass + " mt-1"}
                    >
                      <option value="">Always included</option>
                      {selectors.map((s) => (
                        <option key={s.groupKey} value={s.groupKey}>
                          {s.name || s.groupKey}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="col-span-1 flex items-end justify-end gap-1">
                  <button
                    type="button"
                    title={c.isVisible ? "Visible on website — click to hide" : "Hidden from website — click to show"}
                    onClick={() => updateComponent(idx, { isVisible: !c.isVisible })}
                    className={
                      "p-2 rounded transition " +
                      (c.isVisible
                        ? "text-emerald-600 hover:text-emerald-700"
                        : "text-ink-300 hover:text-ink-500")
                    }
                    aria-label={c.isVisible ? "Visible" : "Hidden"}
                  >
                    {c.isVisible ? (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    ) : (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeComponent(idx)}
                    className="text-ink-400 hover:text-red-600 p-2 rounded"
                    aria-label="Remove component"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Selectors (configurable only) */}
      {bundleType === "configurable" ? (
        <section>
          <header className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[14px] font-semibold text-ink-900">Selectors</h3>
              <p className="text-[12px] text-ink-500 mt-0.5">
                Choices the parent makes (e.g. Grade, Language). Components map to a
                selector via its group key.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={addSelector}
            >
              Add selector
            </Button>
          </header>

          {selectors.length === 0 ? (
            <div className="text-[13px] text-ink-500 italic py-2">
              No selectors yet.
            </div>
          ) : (
            <div className="space-y-2">
              {selectors.map((s, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-end border border-ink-100/70 rounded-xl p-3 bg-cream-50/40"
                >
                  <div className="col-span-3">
                    <label className="text-[11px] font-semibold text-ink-700">
                      Key
                    </label>
                    <input
                      type="text"
                      value={s.groupKey}
                      onChange={(e) =>
                        updateSelector(idx, { groupKey: e.target.value })
                      }
                      className={inputClass + " mt-1 font-mono text-[12px]"}
                    />
                  </div>
                  <div className="col-span-4">
                    <label className="text-[11px] font-semibold text-ink-700">
                      Display name
                    </label>
                    <input
                      type="text"
                      value={s.name}
                      onChange={(e) => updateSelector(idx, { name: e.target.value })}
                      className={inputClass + " mt-1"}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[11px] font-semibold text-ink-700">Type</label>
                    <select
                      value={s.selectorType}
                      onChange={(e) =>
                        updateSelector(idx, {
                          selectorType: e.target.value as "one_of" | "multi",
                        })
                      }
                      className={inputClass + " mt-1"}
                    >
                      <option value="one_of">Pick one</option>
                      <option value="multi">Pick many</option>
                    </select>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5 pb-2">
                    <input
                      type="checkbox"
                      id={`req-${idx}`}
                      checked={s.isRequired}
                      onChange={(e) =>
                        updateSelector(idx, { isRequired: e.target.checked })
                      }
                      className="h-4 w-4"
                    />
                    <label htmlFor={`req-${idx}`} className="text-[12px]">
                      Required
                    </label>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeSelector(idx)}
                      className="text-ink-400 hover:text-red-600 p-2 rounded"
                      aria-label="Remove selector"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-ink-100/70">
        {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        {saved ? (
          <span className="text-[13px] text-emerald-700">Saved ✓</span>
        ) : null}
        <Button
          busy={pending}
          icon={<Save className="h-3.5 w-3.5" />}
          onClick={save}
          type="button"
        >
          Save bundle
        </Button>
      </div>
    </div>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";
