"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Trash2, Save, Package } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/admin/ui/primitives";
import { Button, IconBtn } from "@/components/admin/ui/primitives-client";
import { FormError } from "@/components/admin/ui/form";
import { ProductPicker, type PickedProduct } from "@/components/admin/bundles/ProductPicker";

export type KitLine = { productId: string; name: string; itemCode: string | null; qty: number };

/**
 * Search-and-add one by one — what a uniform set (shirt + trousers + belt
 * + tie) or a box contains. Replaces the BOM editor's type-ahead over the
 * whole catalogue, which shipped every product name to the browser.
 * Saves through the same /api/admin/boms endpoint, which creates the
 * bundle row on first save.
 */
export function KitContentsEditor({
  productId,
  initial,
  title = "Kit contents",
  description = "Only for sets. A plain shirt has nothing here.",
  emptyTitle = "Nothing in this kit",
  optional = true,
}: {
  productId: string;
  initial: KitLine[];
  title?: string;
  description?: string;
  emptyTitle?: string;
  optional?: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<KitLine[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(lines.map((l) => [l.productId, l.qty])) !== JSON.stringify(initial.map((l) => [l.productId, l.qty]));

  const add = (p: PickedProduct) => {
    if (lines.some((l) => l.productId === p.id)) return;
    setLines([...lines, { productId: p.id, name: p.name, itemCode: p.itemCode, qty: 1 }]);
  };
  const setQty = (i: number, qty: number) => setLines(lines.map((l, j) => (j === i ? { ...l, qty: Math.max(1, qty) } : l)));

  function save() {
    setError(null);
    if (lines.length === 0 && !optional) {
      setError("Add at least one item.");
      return;
    }
    start(async () => {
      const r = await fetch("/api/admin/boms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, components: lines.map((l) => ({ productId: l.productId, qty: l.qty })) }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Could not save the contents.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <ProductPicker onPick={add} exclude={[productId, ...lines.map((l) => l.productId)]} placeholder="Search an item by name or item code to add it…" className="mb-4" />
      {lines.length === 0 ? (
        <EmptyState icon={Package} title={emptyTitle} description="Search above to add the first item." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100/70">
          <table className="w-full text-[13px]">
            <thead className="bg-cream-50/60 text-[11px] uppercase tracking-[0.08em] text-ink-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="w-32 px-2 py-2 text-center font-semibold">Qty</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.productId} className="border-t border-ink-100/70">
                  <td className="px-3 py-2">
                    <span className="block font-medium text-ink-900">{l.name}</span>
                    {l.itemCode ? <span className="block font-mono text-[11px] text-ink-500">{l.itemCode}</span> : null}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-center gap-1">
                      <IconBtn size="sm" label="Less" icon={<Minus className="h-3 w-3" />} disabled={l.qty <= 1} onClick={() => setQty(i, l.qty - 1)} />
                      <span className="w-8 text-center tabular-nums">{l.qty}</span>
                      <IconBtn size="sm" label="More" icon={<Plus className="h-3 w-3" />} onClick={() => setQty(i, l.qty + 1)} />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <IconBtn size="sm" tone="danger" label="Remove" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setLines(lines.filter((_, j) => j !== i))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error ? <FormError className="mt-3">{error}</FormError> : null}
      <div className="mt-4 flex items-center justify-end gap-2 border-t border-ink-100/70 pt-4">
        <span className="mr-auto text-[12px] text-ink-500">{lines.length} item{lines.length === 1 ? "" : "s"}{dirty ? " · unsaved" : ""}</span>
        <Button size="sm" busy={pending} disabled={!dirty} icon={<Save className="h-3.5 w-3.5" />} onClick={save}>Save contents</Button>
      </div>
    </Card>
  );
}
