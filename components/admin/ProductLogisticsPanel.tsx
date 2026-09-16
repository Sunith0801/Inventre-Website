"use client";

/**
 * Logistics + identifiers for the product page: HSN, brand, origin, customs,
 * weight, dimensions, MOQ, re-order TAT, plus the read-only UOM and barcode
 * lists that come from the ERP item export.
 */

import { useState } from "react";
import { Save, Check } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, FormGrid, Th, Td, Tr, Badge } from "@/components/admin/ui/primitives";

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
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const dimensions =
        dimL || dimW || dimH
          ? {
              ...(dimL ? { l: Number(dimL) } : {}),
              ...(dimW ? { w: Number(dimW) } : {}),
              ...(dimH ? { h: Number(dimH) } : {}),
            }
          : null;
      const r = await fetch(`/api/admin/products/${productId}`, {
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
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? `Save failed (${r.status})`);
        return;
      }
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  const num = (v: number | "", set: (n: number | "") => void) => ({
    value: v,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value === "" ? "" : Number(e.target.value)),
  });

  return (
    <Card>
      <CardHeader title="Logistics & identifiers" description="Codes and physical details used for invoices, customs and shipping." />

      <FormGrid cols={3}>
        <Field label="HSN / SAC code" htmlFor="lg-hsn">
          <Input id="lg-hsn" value={hsn} onChange={(e) => setHsn(e.target.value)} placeholder="61012000" className="font-mono" />
        </Field>
        <Field label="Brand" htmlFor="lg-brand">
          <Input id="lg-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </Field>
        <Field label="Country of origin" htmlFor="lg-country">
          <Input id="lg-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="India" />
        </Field>
        <Field label="Customs tariff #" htmlFor="lg-customs">
          <Input id="lg-customs" value={customs} onChange={(e) => setCustoms(e.target.value)} className="font-mono" />
        </Field>
        <Field label="Weight (grams)" htmlFor="lg-weight">
          <Input id="lg-weight" type="number" min={0} {...num(weight, setWeight)} className="text-right tabular-nums" />
        </Field>
        <Field label="Dimensions (cm)" htmlFor="lg-dim-l">
          <div className="flex items-center gap-1.5">
            <Input id="lg-dim-l" type="number" step="0.1" min={0} {...num(dimL, setDimL)} placeholder="L" aria-label="Length" className="text-right tabular-nums" />
            <span className="text-[12px] text-ink-300">×</span>
            <Input type="number" step="0.1" min={0} {...num(dimW, setDimW)} placeholder="W" aria-label="Width" className="text-right tabular-nums" />
            <span className="text-[12px] text-ink-300">×</span>
            <Input type="number" step="0.1" min={0} {...num(dimH, setDimH)} placeholder="H" aria-label="Height" className="text-right tabular-nums" />
          </div>
        </Field>
        <Field label="Minimum order qty" htmlFor="lg-moq">
          <Input id="lg-moq" type="number" min={1} value={moq} onChange={(e) => setMoq(Math.max(1, Number(e.target.value || 1)))} className="text-right tabular-nums" />
        </Field>
        <Field label="Re-order lead time (days)" htmlFor="lg-tat">
          <Input id="lg-tat" type="number" min={0} {...num(tat, setTat)} className="text-right tabular-nums" />
        </Field>
      </FormGrid>

      {initial.uoms.length > 0 || initial.barcodes.length > 0 ? (
        <div className="mt-6 grid gap-5 border-t border-ink-100/70 pt-5 lg:grid-cols-2">
          {initial.uoms.length > 0 ? (
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Units of measure</h4>
              <div className="overflow-hidden rounded-xl border border-ink-100/70">
                <table className="w-full">
                  <thead><tr><Th>Unit</Th><Th right>Conversion</Th><Th>Default</Th></tr></thead>
                  <tbody>
                    {initial.uoms.map((u) => (
                      <Tr key={u.id}>
                        <Td>{u.uom}</Td>
                        <Td right muted>× {u.conversionFactor}</Td>
                        <Td>{u.isDefault ? <Badge tone="success" size="sm">Default</Badge> : <span className="text-ink-300">—</span>}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {initial.barcodes.length > 0 ? (
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Barcodes</h4>
              <div className="overflow-hidden rounded-xl border border-ink-100/70">
                <table className="w-full">
                  <thead><tr><Th>Barcode</Th><Th>Type</Th><Th>Unit</Th></tr></thead>
                  <tbody>
                    {initial.barcodes.map((b) => (
                      <Tr key={b.id}>
                        <Td><span className="font-mono">{b.barcode}</span></Td>
                        <Td muted>{b.barcodeType ?? "—"}</Td>
                        <Td muted>{b.uom ?? "—"}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-end gap-3 border-t border-ink-100/70 pt-4">
        {error ? <span className="text-[12.5px] font-medium text-red-600">{error}</span> : null}
        {savedAt && !error ? <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-emerald-700"><Check className="h-3.5 w-3.5" /> Saved</span> : null}
        <Button variant="primary" onClick={save} busy={saving} icon={<Save className="h-3.5 w-3.5" />}>
          Save logistics
        </Button>
      </div>
    </Card>
  );
}
