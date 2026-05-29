"use client";

/**
 * Logistics + identifiers section for admin product page.
 * Shows HSN code, brand, country/customs, weight, dimensions, UOMs, barcodes.
 * UOMs and barcodes are presented as compact editable mini-tables.
 */

import { useState } from "react";
import { Plus, Trash2, Save, Package } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives";

type Props = {
  productId: string;
  initial: {
    hsnCode: string | null;
    brand: string | null;
    countryOfOrigin: string | null;
    customsTariffNumber: string | null;
    weightGrams: number | null;
    dimensions: { l?: number; w?: number; h?: number } | null;
    minOrderQty: number;
    reorderTatDays: number | null;
    uoms: { id: string; uom: string; conversionFactor: string; isDefault: boolean }[];
    barcodes: { id: string; barcode: string; barcodeType: string | null; uom: string | null }[];
  };
};

export function ProductLogisticsPanel({ productId, initial }: Props) {
  const [hsn, setHsn] = useState(initial.hsnCode ?? "");
  const [brand, setBrand] = useState(initial.brand ?? "");
  const [country, setCountry] = useState(initial.countryOfOrigin ?? "");
  const [customs, setCustoms] = useState(initial.customsTariffNumber ?? "");
  const [weight, setWeight] = useState<number | "">(initial.weightGrams ?? "");
  const [dimL, setDimL] = useState<number | "">(initial.dimensions?.l ?? "");
  const [dimW, setDimW] = useState<number | "">(initial.dimensions?.w ?? "");
  const [dimH, setDimH] = useState<number | "">(initial.dimensions?.h ?? "");
  const [moq, setMoq] = useState<number>(initial.minOrderQty);
  const [tat, setTat] = useState<number | "">(initial.reorderTatDays ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setSaving(true);
    try {
      const dimensions =
        dimL || dimW || dimH
          ? {
              ...(dimL ? { l: Number(dimL) } : {}),
              ...(dimW ? { w: Number(dimW) } : {}),
              ...(dimH ? { h: Number(dimH) } : {}),
            }
          : null;
      await fetch(`/api/admin/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hsnCode: hsn || null,
          brand: brand || null,
          countryOfOrigin: country || null,
          customsTariffNumber: customs || null,
          weightGrams: weight === "" ? null : Number(weight),
          dimensions,
          minOrderQty: moq,
          reorderTatDays: tat === "" ? null : Number(tat),
        }),
      });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white">
      <div className="px-5 py-4 border-b border-ink-100 flex items-center gap-2">
        <Package className="h-4 w-4 text-ink-500" />
        <h3 className="font-display text-[15px] font-bold text-ink-900">
          Logistics & identifiers
        </h3>
      </div>

      <div className="p-5 grid grid-cols-2 gap-4">
        <Field label="HSN / SAC code">
          <input
            value={hsn}
            onChange={(e) => setHsn(e.target.value)}
            placeholder="e.g. 61012000"
            className="form-input w-full font-mono text-[13px]"
          />
        </Field>
        <Field label="Brand">
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="form-input w-full"
          />
        </Field>
        <Field label="Country of origin">
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="India"
            className="form-input w-full"
          />
        </Field>
        <Field label="Customs tariff #">
          <input
            value={customs}
            onChange={(e) => setCustoms(e.target.value)}
            className="form-input w-full font-mono text-[13px]"
          />
        </Field>
        <Field label="Weight (grams)">
          <input
            type="number"
            value={weight}
            onChange={(e) =>
              setWeight(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="form-input w-full"
          />
        </Field>
        <Field label="Min order qty">
          <input
            type="number"
            value={moq}
            onChange={(e) => setMoq(Math.max(1, Number(e.target.value || 1)))}
            min={1}
            className="form-input w-full"
          />
        </Field>
        <Field label="Re-order TAT (days)">
          <input
            type="number"
            value={tat}
            onChange={(e) =>
              setTat(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="form-input w-full"
          />
        </Field>
        <Field label="Dimensions (cm: L × W × H)">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              step="0.1"
              value={dimL}
              onChange={(e) => setDimL(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="L"
              className="form-input flex-1 text-[13px]"
            />
            <span className="text-ink-300 text-[12px]">×</span>
            <input
              type="number"
              step="0.1"
              value={dimW}
              onChange={(e) => setDimW(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="W"
              className="form-input flex-1 text-[13px]"
            />
            <span className="text-ink-300 text-[12px]">×</span>
            <input
              type="number"
              step="0.1"
              value={dimH}
              onChange={(e) => setDimH(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="H"
              className="form-input flex-1 text-[13px]"
            />
          </div>
        </Field>
      </div>

      {initial.uoms.length > 0 && (
        <div className="border-t border-ink-100 px-5 py-4">
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500 mb-2">
            Units of measure ({initial.uoms.length})
          </p>
          <div className="rounded-lg border border-ink-100 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-cream-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-ink-700">UOM</th>
                  <th className="text-right px-3 py-2 font-semibold text-ink-700">Conversion ×</th>
                  <th className="text-center px-3 py-2 font-semibold text-ink-700">Default</th>
                </tr>
              </thead>
              <tbody>
                {initial.uoms.map((u) => (
                  <tr key={u.id} className="border-t border-ink-100/60">
                    <td className="px-3 py-2 font-medium text-ink-900">{u.uom}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-700">
                      {u.conversionFactor}
                    </td>
                    <td className="px-3 py-2 text-center text-ink-500">
                      {u.isDefault ? "✓" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {initial.barcodes.length > 0 && (
        <div className="border-t border-ink-100 px-5 py-4">
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500 mb-2">
            Barcodes ({initial.barcodes.length})
          </p>
          <div className="rounded-lg border border-ink-100 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-cream-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-ink-700">Barcode</th>
                  <th className="text-left px-3 py-2 font-semibold text-ink-700">Type</th>
                  <th className="text-left px-3 py-2 font-semibold text-ink-700">UOM</th>
                </tr>
              </thead>
              <tbody>
                {initial.barcodes.map((b) => (
                  <tr key={b.id} className="border-t border-ink-100/60">
                    <td className="px-3 py-2 font-mono text-[12px] text-ink-900">{b.barcode}</td>
                    <td className="px-3 py-2 text-ink-700">{b.barcodeType ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-700">{b.uom ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="border-t border-ink-100 px-5 py-3 flex items-center justify-between">
        <p className="text-[12px] text-ink-500">
          {savedAt ? (
            <span className="text-emerald-700">Saved.</span>
          ) : (
            "From Item.csv export — editable."
          )}
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={save}
          disabled={saving}
          icon={<Save className="h-3.5 w-3.5" />}
        >
          {saving ? "Saving…" : "Save logistics"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
