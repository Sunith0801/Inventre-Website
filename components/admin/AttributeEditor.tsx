"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowUp, ArrowDown, ListPlus, Hash, List } from "lucide-react";
import { Button, IconBtn } from "@/components/admin/ui/primitives-client";
import { Input, Checkbox, Textarea, FormError } from "@/components/admin/ui/form";
import { Dialog } from "@/components/admin/ui/dialog";
import { cn } from "@/lib/cn";

type AttrValue = {
  id?: string; // undefined for newly-added rows
  value: string;
  displayLabel: string | null;
  shortCode: string | null;
  hexColor: string | null;
  sortOrder: number;
  isActive: boolean;
};

type Props = {
  attributeId: string;
  attributeType: string;
  readOnly?: boolean;
  initialIsDisabled: boolean;
  initialIsNumeric: boolean;
  initialFromRange: number | null;
  initialToRange: number | null;
  initialIncrement: number | null;
  initialValues: AttrValue[];
};

const blank = (sortOrder: number): AttrValue => ({
  value: "",
  displayLabel: "",
  shortCode: null,
  hexColor: null,
  sortOrder,
  isActive: true,
});

/** The values a numeric range would generate — shown so a typo in the step is visible before save. */
function expandRange(from: string, to: string, inc: string): number[] | null {
  const f = Number(from), t = Number(to), i = Number(inc);
  if (!from || !to || !inc || !Number.isFinite(f) || !Number.isFinite(t) || !(i > 0) || t < f) return null;
  const n = Math.floor((t - f) / i + 1e-9) + 1;
  if (n > 500) return null;
  return Array.from({ length: n }, (_, k) => Number((f + k * i).toFixed(3)));
}

export function AttributeEditor({
  attributeId,
  attributeType,
  readOnly = false,
  initialIsDisabled,
  initialIsNumeric,
  initialFromRange,
  initialToRange,
  initialIncrement,
  initialValues,
}: Props) {
  const router = useRouter();
  const [isDisabled, setIsDisabled] = useState(initialIsDisabled);
  const [isNumeric, setIsNumeric] = useState(initialIsNumeric);
  const [fromRange, setFromRange] = useState(initialFromRange != null ? String(initialFromRange) : "");
  const [toRange, setToRange] = useState(initialToRange != null ? String(initialToRange) : "");
  const [increment, setIncrement] = useState(initialIncrement != null ? String(initialIncrement) : "");
  const [values, setValues] = useState<AttrValue[]>(initialValues.length > 0 ? initialValues : [blank(1)]);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pending, start] = useTransition();
  const isColor = attributeType === "color";

  // Dirty = anything differs from what the server sent. Drives the footer:
  // a "Save" that is always enabled teaches people to click it "just in case".
  const dirty = useMemo(() => {
    if (isDisabled !== initialIsDisabled || isNumeric !== initialIsNumeric) return true;
    if (isNumeric) {
      return (
        fromRange !== (initialFromRange != null ? String(initialFromRange) : "") ||
        toRange !== (initialToRange != null ? String(initialToRange) : "") ||
        increment !== (initialIncrement != null ? String(initialIncrement) : "")
      );
    }
    const a = values.filter((v) => v.value.trim());
    if (a.length !== initialValues.length) return true;
    return a.some((v, i) => {
      const o = initialValues[i];
      return (
        !o || v.id !== o.id || v.value !== o.value || (v.displayLabel ?? "") !== (o.displayLabel ?? "") ||
        (v.shortCode ?? "") !== (o.shortCode ?? "") || (v.hexColor ?? "") !== (o.hexColor ?? "") || v.isActive !== o.isActive
      );
    });
  }, [isDisabled, isNumeric, fromRange, toRange, increment, values, initialIsDisabled, initialIsNumeric, initialFromRange, initialToRange, initialIncrement, initialValues]);

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const v of values) {
      const k = v.value.trim().toLowerCase();
      if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [values]);

  const rangePreview = useMemo(() => expandRange(fromRange, toRange, increment), [fromRange, toRange, increment]);

  function patchRow(idx: number, patch: Partial<AttrValue>) {
    setValues((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setValues((prev) => [...prev, blank(prev.length + 1)]);
  }
  function removeRow(idx: number) {
    setValues((prev) => (prev.length === 1 ? [blank(1)] : prev.filter((_, i) => i !== idx)));
  }
  function move(idx: number, dir: -1 | 1) {
    setValues((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
  }
  function addPasted() {
    const existing = new Set(values.map((v) => v.value.trim().toLowerCase()).filter(Boolean));
    const incoming = pasteText
      .split(/[\n,;\t]+/)
      .map((s) => s.trim())
      .filter((s) => s && !existing.has(s.toLowerCase()));
    if (incoming.length) {
      setValues((prev) => {
        const base = prev.filter((v) => v.value.trim());
        return [...base, ...incoming.map((v, i) => ({ ...blank(base.length + i + 1), value: v, displayLabel: v }))];
      });
    }
    setPasteText("");
    setPasteOpen(false);
  }

  function save() {
    setError(null);
    if (!isNumeric && duplicates.size) {
      setError("Two rows have the same value — each value must be unique.");
      return;
    }
    const clean = values.filter((v) => v.value.trim().length > 0);
    start(async () => {
      const attrRes = await fetch(`/api/admin/attributes/${attributeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isDisabled,
          isNumeric,
          numericFromRange: isNumeric && fromRange ? Number(fromRange) : null,
          numericToRange: isNumeric && toRange ? Number(toRange) : null,
          numericIncrement: isNumeric && increment ? Number(increment) : null,
        }),
      });
      if (!attrRes.ok) {
        setError("Failed to save attribute settings");
        return;
      }
      if (!isNumeric) {
        const valsRes = await fetch(`/api/admin/attributes/${attributeId}/values/bulk`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            values: clean.map((v) => ({
              id: v.id,
              value: v.value.trim(),
              displayLabel: v.displayLabel?.trim() || null,
              shortCode: v.shortCode?.trim() || null,
              hexColor: v.hexColor || null,
              isActive: v.isActive,
            })),
          }),
        });
        if (!valsRes.ok) {
          const d = await valsRes.json().catch(() => ({}));
          setError(d.error ?? "Failed to save values");
          return;
        }
      }
      router.refresh();
    });
  }

  function discard() {
    setIsDisabled(initialIsDisabled);
    setIsNumeric(initialIsNumeric);
    setFromRange(initialFromRange != null ? String(initialFromRange) : "");
    setToRange(initialToRange != null ? String(initialToRange) : "");
    setIncrement(initialIncrement != null ? String(initialIncrement) : "");
    setValues(initialValues.length > 0 ? initialValues : [blank(1)]);
    setError(null);
  }

  const activeCount = values.filter((v) => v.value.trim() && v.isActive).length;
  const totalCount = values.filter((v) => v.value.trim()).length;

  return (
    <div className="space-y-5">
      {/* ── How values are defined ── */}
      <div className="flex flex-col gap-4 border-b border-ink-100/70 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 text-[12px] font-semibold text-ink-700">Values come from</div>
          <div role="radiogroup" className="inline-flex rounded-lg border border-ink-100 bg-cream-50 p-0.5">
            {[
              { on: !isNumeric, label: "A list", icon: List, set: () => setIsNumeric(false) },
              { on: isNumeric, label: "A numeric range", icon: Hash, set: () => setIsNumeric(true) },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={o.on}
                disabled={readOnly}
                onClick={o.set}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                  o.on ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800",
                )}
              >
                <o.icon className="h-3.5 w-3.5" />
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <Checkbox
          checked={!isDisabled}
          disabled={readOnly}
          onChange={(e) => setIsDisabled(!e.target.checked)}
          label="Enabled"
          hint="Disabled attributes stay on existing variants but cannot be added to new products."
          className="max-w-xs"
        />
      </div>

      {error ? <FormError>{error}</FormError> : null}

      {isNumeric ? (
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-ink-900">Numeric range</h3>
            <span className="text-[12px] text-ink-500">Variants pick any step between the two ends.</span>
          </div>
          <div className="grid max-w-md grid-cols-3 gap-3">
            {[
              { label: "From", v: fromRange, set: setFromRange },
              { label: "To", v: toRange, set: setToRange },
              { label: "Step", v: increment, set: setIncrement },
            ].map((f) => (
              <label key={f.label} className="block">
                <span className="text-[12px] font-semibold text-ink-700">{f.label}</span>
                <Input type="number" step="any" className="mt-1.5" value={f.v} disabled={readOnly} onChange={(e) => f.set(e.target.value)} />
              </label>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-ink-100/70 bg-cream-50/60 px-3 py-2.5 text-[12px]">
            {rangePreview ? (
              <>
                <span className="font-semibold text-ink-800">{rangePreview.length} values:</span>{" "}
                <span className="text-ink-600 tabular-nums">
                  {rangePreview.slice(0, 12).join(", ")}
                  {rangePreview.length > 12 ? ` … ${rangePreview[rangePreview.length - 1]}` : ""}
                </span>
              </>
            ) : (
              <span className="text-ink-500">Fill all three to preview the values this range produces.</span>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-ink-900">
              Values{" "}
              <span className="text-[12px] font-normal text-ink-500">
                {totalCount ? `${activeCount} active of ${totalCount}` : "none yet"}
              </span>
            </h3>
            {!readOnly ? (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" icon={<ListPlus className="h-3.5 w-3.5" />} onClick={() => setPasteOpen(true)}>
                  Paste a list
                </Button>
                <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={addRow}>
                  Add value
                </Button>
              </div>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-xl border border-ink-100/70">
            <table className="w-full text-[13px]">
              <thead className="bg-cream-50/60 text-[11px] uppercase tracking-[0.08em] text-ink-500">
                <tr>
                  <th className="w-9 px-2 py-2 text-right font-semibold">#</th>
                  <th className="px-2 py-2 text-left font-semibold">Value <span className="normal-case tracking-normal text-ink-400">(as stored)</span></th>
                  <th className="px-2 py-2 text-left font-semibold">Label <span className="normal-case tracking-normal text-ink-400">(as shown)</span></th>
                  <th className="w-20 px-2 py-2 text-left font-semibold">Code</th>
                  {isColor ? <th className="w-16 px-2 py-2 text-left font-semibold">Swatch</th> : null}
                  <th className="w-16 px-2 py-2 text-center font-semibold">Active</th>
                  {!readOnly ? <th className="w-24 px-2 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {values.map((v, i) => {
                  const dup = v.value.trim() && duplicates.has(v.value.trim().toLowerCase());
                  return (
                    <tr
                      key={v.id ?? `new-${i}`}
                      className={cn("border-t border-ink-100/70", !v.isActive && "bg-cream-50/40 text-ink-400", dup && "bg-red-50/60")}
                    >
                      <td className="px-2 py-1 text-right tabular-nums text-ink-400">{i + 1}</td>
                      <td className="px-1 py-1">
                        <Input
                          inputSize="sm"
                          value={v.value}
                          invalid={!!dup}
                          disabled={readOnly}
                          onChange={(e) => patchRow(i, { value: e.target.value })}
                          placeholder={isColor ? "e.g. Navy" : "e.g. 32"}
                          autoFocus={!v.id && !v.value && i === values.length - 1 && values.length > 1}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          inputSize="sm"
                          value={v.displayLabel ?? ""}
                          disabled={readOnly}
                          onChange={(e) => patchRow(i, { displayLabel: e.target.value })}
                          placeholder={v.value || "Same as value"}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          inputSize="sm"
                          className="font-mono uppercase"
                          maxLength={4}
                          value={v.shortCode ?? ""}
                          disabled={readOnly}
                          onChange={(e) => patchRow(i, { shortCode: e.target.value.toUpperCase() })}
                          placeholder="—"
                        />
                      </td>
                      {isColor ? (
                        <td className="px-2 py-1">
                          <label className="inline-flex cursor-pointer items-center gap-1.5">
                            <span className="h-6 w-6 rounded-md border border-black/10 shadow-inner" style={{ background: v.hexColor || "transparent" }} />
                            <input
                              type="color"
                              value={v.hexColor || "#000000"}
                              disabled={readOnly}
                              onChange={(e) => patchRow(i, { hexColor: e.target.value })}
                              className="h-0 w-0 opacity-0"
                              aria-label={`Swatch for ${v.value || "value"}`}
                            />
                          </label>
                        </td>
                      ) : null}
                      <td className="px-2 py-1 text-center">
                        <Checkbox checked={v.isActive} disabled={readOnly} onChange={(e) => patchRow(i, { isActive: e.target.checked })} aria-label="Active" className="justify-center" />
                      </td>
                      {!readOnly ? (
                        <td className="px-1 py-1">
                          <div className="flex items-center justify-end gap-0.5">
                            <IconBtn size="sm" label="Move up" icon={<ArrowUp className="h-3.5 w-3.5" />} disabled={i === 0} onClick={() => move(i, -1)} />
                            <IconBtn size="sm" label="Move down" icon={<ArrowDown className="h-3.5 w-3.5" />} disabled={i === values.length - 1} onClick={() => move(i, 1)} />
                            <IconBtn size="sm" tone="danger" label="Remove" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeRow(i)} />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-ink-500">
            Order here is the order sizes appear on the storefront. Inactive values stay on old variants but are hidden from new ones.
          </p>
        </div>
      )}

      {!readOnly ? (
        <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-between gap-3 rounded-b-2xl border-t border-ink-100/70 bg-white/95 px-5 py-3 backdrop-blur lg:-mx-6 lg:-mb-6 lg:px-6">
          <span className={cn("text-[12px]", dirty ? "font-medium text-amber-800" : "text-ink-400")}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <div className="flex items-center gap-2">
            {dirty ? (
              <Button variant="ghost" size="sm" onClick={discard} disabled={pending}>
                Discard
              </Button>
            ) : null}
            <Button busy={pending} variant="primary" onClick={save} disabled={!dirty}>
              Save
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste a list of values"
        description="One per line, or separated by commas. Values already in the table are skipped."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasteOpen(false)}>Cancel</Button>
            <Button onClick={addPasted} disabled={!pasteText.trim()}>Add values</Button>
          </>
        }
      >
        <Textarea rows={8} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"22\n24\n26\n28"} autoFocus />
      </Dialog>
    </div>
  );
}
