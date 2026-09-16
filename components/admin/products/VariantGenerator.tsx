"use client";

import { useMemo, useState } from "react";
import { Check, Grid3x3 } from "lucide-react";
import { Dialog } from "@/components/admin/ui/dialog";
import { Button } from "@/components/admin/ui/primitives-client";
import { Select } from "@/components/admin/ui/form";
import { cn } from "@/lib/cn";

export type AttributeOption = {
  id: string;
  name: string;
  type: "size" | "color" | "design" | "model" | "other";
  values: { id: string; label: string }[];
};

export type GeneratedRow = { size: string; colorValueId: string | null; colorLabel: string };

/**
 * Colour × Size matrix for the edit page. The create wizard had one; the
 * edit page made admins type each size by hand, so a second colour meant
 * re-entering every size. Pick the values, get every combination that
 * doesn't already exist.
 */
export function VariantGenerator({
  open,
  onClose,
  attributes,
  existing,
  onGenerate,
}: {
  open: boolean;
  onClose: () => void;
  attributes: AttributeOption[];
  /** "colour|size" keys already in the table, so nothing is duplicated. */
  existing: Set<string>;
  onGenerate: (rows: GeneratedRow[]) => void;
}) {
  const sizeAttrs = attributes.filter((a) => a.type === "size" && a.values.length);
  const colourAttrs = attributes.filter((a) => a.type === "color" && a.values.length);
  const [sizeAttrId, setSizeAttrId] = useState(sizeAttrs[0]?.id ?? "");
  const [colourAttrId, setColourAttrId] = useState("");
  const [sizes, setSizes] = useState<Set<string>>(new Set());
  const [colours, setColours] = useState<Set<string>>(new Set());

  const sizeAttr = sizeAttrs.find((a) => a.id === sizeAttrId);
  const colourAttr = colourAttrs.find((a) => a.id === colourAttrId);

  const rows = useMemo(() => {
    if (!sizeAttr) return [];
    const sizeVals = sizeAttr.values.filter((v) => sizes.has(v.id));
    const colourVals = colourAttr ? colourAttr.values.filter((v) => colours.has(v.id)) : [{ id: null as string | null, label: "" }];
    const out: GeneratedRow[] = [];
    for (const c of colourVals.length ? colourVals : [{ id: null as string | null, label: "" }]) {
      for (const s of sizeVals) {
        if (existing.has(`${c.id ?? ""}|${s.label}`)) continue;
        out.push({ size: s.label, colorValueId: c.id, colorLabel: c.label });
      }
    }
    return out;
  }, [sizeAttr, colourAttr, sizes, colours, existing]);

  const toggleAll = (vals: { id: string }[], set: Set<string>, setter: (s: Set<string>) => void) =>
    setter(set.size === vals.length ? new Set() : new Set(vals.map((v) => v.id)));
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  };

  const Chips = ({ vals, set, setter }: { vals: { id: string; label: string }[]; set: Set<string>; setter: (s: Set<string>) => void }) => (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" onClick={() => toggleAll(vals, set, setter)} className="rounded-lg border border-dashed border-ink-300 px-2.5 py-1 text-[12px] font-medium text-ink-600 hover:border-ink-500">
        {set.size === vals.length ? "None" : "All"}
      </button>
      {vals.map((v) => {
        const on = set.has(v.id);
        return (
          <button key={v.id} type="button" aria-pressed={on} onClick={() => toggle(set, setter, v.id)}
            className={cn("inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors", on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-100 bg-white text-ink-700 hover:border-ink-300")}>
            {on ? <Check className="h-3 w-3" /> : null}{v.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Generate sizes and colours"
      description="Every combination becomes a row with its own SKU. Rows that already exist are skipped."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button icon={<Grid3x3 className="h-3.5 w-3.5" />} disabled={rows.length === 0} onClick={() => { onGenerate(rows); onClose(); }}>
            Add {rows.length} variant{rows.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {sizeAttrs.length === 0 ? (
        <p className="text-[13px] text-ink-600">No size attribute has values yet. Add one under Catalog → Attributes first.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <span className="text-[12px] font-semibold text-ink-700">Sizes from</span>
              <Select selectSize="sm" className="max-w-[240px]" value={sizeAttrId} onChange={(e) => { setSizeAttrId(e.target.value); setSizes(new Set()); }}>
                {sizeAttrs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
            {sizeAttr ? <Chips vals={sizeAttr.values} set={sizes} setter={setSizes} /> : null}
          </div>
          <div>
            <div className="mb-2 flex items-center gap-3">
              <span className="text-[12px] font-semibold text-ink-700">Colours from</span>
              <Select selectSize="sm" className="max-w-[240px]" value={colourAttrId} onChange={(e) => { setColourAttrId(e.target.value); setColours(new Set()); }}>
                <option value="">No colour axis</option>
                {colourAttrs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
            {colourAttr ? <Chips vals={colourAttr.values} set={colours} setter={setColours} /> : null}
          </div>
          <p className="rounded-lg bg-cream-50 px-3 py-2 text-[12px] text-ink-600">
            {rows.length === 0
              ? "Pick at least one size."
              : `${rows.length} new row${rows.length === 1 ? "" : "s"}: ${rows.slice(0, 6).map((r) => (r.colorLabel ? `${r.colorLabel} / ${r.size}` : r.size)).join(", ")}${rows.length > 6 ? " …" : ""}`}
          </p>
        </div>
      )}
    </Dialog>
  );
}
