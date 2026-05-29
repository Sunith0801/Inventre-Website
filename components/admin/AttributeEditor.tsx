"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

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
  initialIsDisabled: boolean;
  initialIsNumeric: boolean;
  initialFromRange: number | null;
  initialToRange: number | null;
  initialIncrement: number | null;
  initialValues: AttrValue[];
};

export function AttributeEditor({
  attributeId,
  attributeType,
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
  const [fromRange, setFromRange] = useState<string>(
    initialFromRange != null ? String(initialFromRange) : ""
  );
  const [toRange, setToRange] = useState<string>(
    initialToRange != null ? String(initialToRange) : ""
  );
  const [increment, setIncrement] = useState<string>(
    initialIncrement != null ? String(initialIncrement) : ""
  );
  const [values, setValues] = useState<AttrValue[]>(
    initialValues.length > 0
      ? initialValues
      : [{ value: "", displayLabel: "", shortCode: null, hexColor: null, sortOrder: 1, isActive: true }]
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isColor = attributeType === "color";

  function patchRow(idx: number, patch: Partial<AttrValue>) {
    setValues((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setValues((prev) => [
      ...prev,
      {
        value: "",
        displayLabel: "",
        shortCode: null,
        hexColor: null,
        sortOrder: prev.length + 1,
        isActive: true,
      },
    ]);
  }

  function removeRow(idx: number) {
    setValues((prev) => prev.filter((_, i) => i !== idx));
  }

  function save() {
    setError(null);
    const clean = values.filter((v) => v.value.trim().length > 0);
    start(async () => {
      // 1. Patch the attribute itself
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
      // 2. Bulk-replace the values table (only if non-numeric)
      if (!isNumeric) {
        const valsRes = await fetch(
          `/api/admin/attributes/${attributeId}/values/bulk`,
          {
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
          }
        );
        if (!valsRes.ok) {
          const d = await valsRes.json().catch(() => ({}));
          setError(d.error ?? "Failed to save values");
          return;
        }
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Top checkboxes (mirrors ERP Numeric Values / Disabled) ── */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pb-4 border-b border-ink-100/70">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isNumeric}
            onChange={(e) => setIsNumeric(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300"
          />
          <span className="text-[13px] font-medium text-ink-800">Numeric Values</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isDisabled}
            onChange={(e) => setIsDisabled(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300"
          />
          <span className="text-[13px] font-medium text-ink-800">Disabled</span>
        </label>
      </div>

      {isNumeric ? (
        /* ── Numeric range editor ── */
        <div className="space-y-3">
          <h3 className="text-[14px] font-semibold text-ink-900">
            Numeric range
          </h3>
          <p className="text-[12px] text-ink-500">
            Variants will pick a value from this range with the given step.
          </p>
          <div className="grid grid-cols-3 gap-3 max-w-md">
            <div>
              <label className="text-[12px] font-semibold text-ink-700">From</label>
              <input
                type="number"
                value={fromRange}
                step="any"
                onChange={(e) => setFromRange(e.target.value)}
                className={inputClass + " mt-1.5"}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-ink-700">To</label>
              <input
                type="number"
                value={toRange}
                step="any"
                onChange={(e) => setToRange(e.target.value)}
                className={inputClass + " mt-1.5"}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-ink-700">Increment</label>
              <input
                type="number"
                value={increment}
                step="any"
                onChange={(e) => setIncrement(e.target.value)}
                className={inputClass + " mt-1.5"}
              />
            </div>
          </div>
        </div>
      ) : (
        /* ── Item Attribute Values table (ERP-style) ── */
        <div className="space-y-3">
          <h3 className="text-[14px] font-semibold text-ink-900">
            Item Attribute Values
          </h3>
          <div className="border border-ink-100/70 rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-cream-50/60">
                <tr>
                  <th className="w-10 px-2 py-2 text-left font-medium text-ink-500"></th>
                  <th className="w-12 px-2 py-2 text-left font-medium text-ink-500">No.</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-700">
                    Attribute Value <span className="text-red-600">*</span>
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-ink-700">
                    Abbreviation <span className="text-red-600">*</span>
                  </th>
                  {isColor ? (
                    <th className="w-20 px-3 py-2 text-left font-medium text-ink-700">Color</th>
                  ) : null}
                  <th className="w-10 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {values.map((v, i) => (
                  <tr key={v.id ?? `new-${i}`} className="border-t border-ink-100/70 hover:bg-cream-50/40">
                    <td className="px-2 py-1.5 text-center">
                      <GripVertical className="h-3.5 w-3.5 text-ink-300 inline" />
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-ink-500">{i + 1}</td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={v.value}
                        onChange={(e) => patchRow(i, { value: e.target.value })}
                        className={cellInputClass}
                        placeholder="e.g. TSUS Grade 11 Computer Science"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={v.displayLabel ?? ""}
                        onChange={(e) => patchRow(i, { displayLabel: e.target.value })}
                        className={cellInputClass}
                        placeholder="e.g. Computer Science"
                      />
                    </td>
                    {isColor ? (
                      <td className="px-1 py-1">
                        <input
                          type="color"
                          value={v.hexColor || "#000000"}
                          onChange={(e) => patchRow(i, { hexColor: e.target.value })}
                          className="h-7 w-12 rounded border border-ink-200 cursor-pointer"
                        />
                      </td>
                    ) : null}
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => removeRow(i)}
                        type="button"
                        className="text-ink-400 hover:text-red-600 p-1 rounded"
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {values.length === 0 ? (
                  <tr>
                    <td colSpan={isColor ? 6 : 5} className="px-3 py-6 text-center text-ink-400 italic">
                      No values yet — add the first row.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="text-[13px] px-3 py-1.5 border border-ink-200 rounded-lg hover:bg-cream-50 inline-flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Add Row
          </button>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-ink-100/70">
        <div>
          {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
        </div>
        <Button busy={pending} variant="primary" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

const cellInputClass =
  "w-full h-8 px-2 text-[13px] rounded bg-white border border-transparent placeholder:text-ink-400 " +
  "hover:border-ink-200 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";
