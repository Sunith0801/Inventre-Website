"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui/primitives";

export type VariantRow = {
  variantId: string;
  label: string;
  sku: string;
  axes: { name: string; value: string }[];
  overridePaise: number | null;
};

export function ComboPricesEditor({
  productId,
  basePricePaise,
  priceListId,
  variants,
}: {
  productId: string;
  basePricePaise: number;
  priceListId: string;
  variants: VariantRow[];
}) {
  const router = useRouter();
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const v of variants) {
      m[v.variantId] =
        v.overridePaise == null ? "" : (v.overridePaise / 100).toFixed(2);
    }
    return m;
  }, [variants]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const baseRs = (basePricePaise / 100).toFixed(0);

  const dirtyCount = Object.keys(values).filter(
    (k) => values[k] !== initial[k],
  ).length;

  async function onSave() {
    setBusy(true);
    setMsg(null);
    // Convert each to paise; blank = clear (null). Reject non-numeric.
    const updates: { variantId: string; pricePaise: number | null }[] = [];
    for (const v of variants) {
      const raw = (values[v.variantId] ?? "").trim();
      if (raw === "") {
        updates.push({ variantId: v.variantId, pricePaise: null });
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          setMsg({ kind: "err", text: `Bad number for ${v.label}: "${raw}"` });
          setBusy(false);
          return;
        }
        updates.push({ variantId: v.variantId, pricePaise: Math.round(n * 100) });
      }
    }
    const r = await fetch(`/api/admin/products/${productId}/combo-prices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priceListId, updates }),
    });
    if (!r.ok) {
      const t = await r.text();
      setMsg({ kind: "err", text: `Save failed: ${t || r.status}` });
      setBusy(false);
      return;
    }
    setMsg({ kind: "ok", text: `Saved ${updates.length} variant(s).` });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white">
      <div className="flex items-center justify-between px-5 py-3 border-b border-ink-100">
        <p className="text-[13px] text-ink-700">
          {variants.length} variant{variants.length === 1 ? "" : "s"} ·{" "}
          {dirtyCount > 0 ? (
            <span className="font-semibold text-ink-900">
              {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="text-ink-500">no changes</span>
          )}
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          disabled={busy || dirtyCount === 0}
        >
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
      {msg && (
        <div
          className={
            "px-5 py-2 text-[12.5px] " +
            (msg.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 border-b border-emerald-200"
              : "bg-red-50 text-red-800 border-b border-red-200")
          }
        >
          {msg.text}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-cream-50/60 text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="text-left px-5 py-2 font-semibold">Combo</th>
              <th className="text-left px-5 py-2 font-semibold">SKU</th>
              <th className="text-right px-5 py-2 font-semibold w-44">
                Price (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => {
              const dirty = values[v.variantId] !== initial[v.variantId];
              return (
                <tr key={v.variantId} className="border-t border-ink-50">
                  <td className="px-5 py-1.5 text-ink-800">
                    {v.axes.length > 0
                      ? v.axes.map((a) => a.value).join(" · ")
                      : v.label}
                  </td>
                  <td className="px-5 py-1.5 text-ink-500 font-mono text-[12px]">
                    {v.sku}
                  </td>
                  <td className="px-5 py-1.5 text-right">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1"
                      value={values[v.variantId] ?? ""}
                      onChange={(e) =>
                        setValues((cur) => ({
                          ...cur,
                          [v.variantId]: e.target.value,
                        }))
                      }
                      placeholder={baseRs}
                      className={
                        "w-32 rounded-md border px-2 py-1 text-right text-[13px] focus:outline-none focus:border-ink-900 " +
                        (dirty
                          ? "border-amber-400 bg-amber-50"
                          : "border-ink-200")
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
