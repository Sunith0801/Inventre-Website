"use client";

/**
 * Shared axes-picker + variants-matrix UI used by:
 *  - Uniform wizard (Step 3 + Step 4)
 *  - Bookkit wizard (Step 4, when "multi-axis" variant style is picked)
 *
 * The matrix shape (`AxisDef`, `VariantRow`) is what both server actions
 * accept — `axes` and `variants` arrays on either payload — so callers
 * can pass the result straight through.
 */

import { useMemo, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

export type AttributeOption = {
  id: string;
  name: string;
  type: "size" | "color" | "design" | "model" | "other";
  values: { id: string; label: string }[];
};

export type SelectedAxis = {
  attributeId: string;
  selectedValueIds: string[];
};

export type AxisDef = {
  attributeId: string;
  attributeName: string;
  values: { id: string; label: string }[];
};

/**
 * Convert the wizard's internal axis shape (id-keyed) to the server's
 * AxisPayload shape (valueId-keyed). Keeps the picker code idiomatic
 * while matching the API contract enforced by the Zod schema on
 * `/app/admin/.../catalog/build/actions.ts`.
 */
export function axisDefToPayload(a: AxisDef): {
  attributeId: string;
  attributeName: string;
  values: { valueId: string; label: string }[];
} {
  return {
    attributeId: a.attributeId,
    attributeName: a.attributeName,
    values: a.values.map((v) => ({ valueId: v.id, label: v.label })),
  };
}

export type VariantRow = {
  axisValueIds: string[];
  sizeLabel: string;
  sku: string;
  stockQty: number;
  isActive: boolean;
};

/** Cartesian product of all axis values → blueprint variants array. */
export function buildVariantBlueprint(
  axesResolved: AxisDef[],
  name: string,
): VariantRow[] {
  if (axesResolved.length === 0 || axesResolved.some((a) => a.values.length === 0)) {
    return [];
  }
  const combos: { ids: string[]; labels: string[] }[] = [{ ids: [], labels: [] }];
  for (const axis of axesResolved) {
    const next: { ids: string[]; labels: string[] }[] = [];
    for (const c of combos) {
      for (const v of axis.values) {
        next.push({ ids: [...c.ids, v.id], labels: [...c.labels, v.label] });
      }
    }
    combos.splice(0, combos.length, ...next);
  }
  return combos.map((c) => ({
    axisValueIds: c.ids,
    sizeLabel: c.labels.join(" · "),
    sku: deriveSku(name, c.labels),
    stockQty: 0,
    isActive: true,
  }));
}

export function resolveAxes(
  axes: SelectedAxis[],
  attributes: AttributeOption[],
): AxisDef[] {
  return axes
    .map((a) => {
      const attr = attributes.find((x) => x.id === a.attributeId);
      if (!attr) return null;
      const values = a.selectedValueIds
        .map((vid) => attr.values.find((v) => v.id === vid))
        .filter((v): v is { id: string; label: string } => !!v);
      return { attributeId: attr.id, attributeName: attr.name, values };
    })
    .filter((x): x is AxisDef => !!x);
}

/** Sync setter: copy a recomputed memo value into state when its identity
 *  changes (cheaper than useEffect). Used by both wizards to keep the
 *  variants matrix in lockstep with the axes blueprint. */
export function useMemoSync<T>(src: T, sink: (v: T) => void) {
  const last = useRef<T | undefined>(undefined);
  if (last.current !== src) {
    last.current = src;
    sink(src);
  }
}

/** Default SKU like "SAS-BP-SHIRT-WHITE-30". Admins can edit per row. */
export function deriveSku(name: string, labels: string[]): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const tail = labels
    .map((l) => l.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8))
    .join("-");
  return tail ? `${base}-${tail}` : base;
}

// ─────────────────── presentational sub-components ───────────────────

export function AxesPicker({
  axes,
  setAxes,
  attributes,
  setAttributes,
  allowedTypes,
}: {
  axes: SelectedAxis[];
  setAxes: (v: SelectedAxis[]) => void;
  attributes: AttributeOption[];
  /** Owner-side state setter. Required so inline "+ Create new attribute"
   *  / "+ Add new value" actions can append to the catalog without
   *  reloading the page. */
  setAttributes: (next: AttributeOption[]) => void;
  /** Constrain which attribute types this picker exposes — Uniform wizard
   *  passes `["size","color"]`, Bookkit wizard passes the complement so
   *  Mandate / Core Subject / Elective / etc. show up but Size / Colour
   *  don't pollute the dropdown. Omit to allow all types. */
  allowedTypes?: AttributeOption["type"][];
}) {
  const usedIds = new Set(axes.map((a) => a.attributeId));
  const allowed = (a: AttributeOption) =>
    !allowedTypes || allowedTypes.includes(a.type);
  const available = attributes.filter((a) => !usedIds.has(a.id) && allowed(a));
  const [showCreate, setShowCreate] = useState(false);
  const [valueAdderFor, setValueAdderFor] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {axes.length === 0 && (
        <p className="text-[12px] text-ink-400 italic">
          No axes yet. Pick one from the dropdown below — or click <b>+
          Create new attribute</b> to add one.
        </p>
      )}
      {axes.map((a, i) => {
        const attr = attributes.find((x) => x.id === a.attributeId);
        if (!attr) return null;
        return (
          <div key={a.attributeId} className="rounded-xl border border-ink-200 bg-white p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-bold text-ink-900">
                Axis {i + 1} · {attr.name}
                <span className="ml-2 text-[10.5px] uppercase tracking-wider text-ink-400">
                  {attr.type}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setAxes(axes.filter((_, idx) => idx !== i))}
                className="text-ink-400 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {attr.values.map((v) => {
                const on = a.selectedValueIds.includes(v.id);
                const splittable = splitComboValue(v.label).length > 1;
                return (
                  <span key={v.id} className="inline-flex items-center">
                    <button
                      type="button"
                      onClick={() =>
                        setAxes(
                          axes.map((x, idx) =>
                            idx !== i
                              ? x
                              : {
                                  ...x,
                                  selectedValueIds: on
                                    ? x.selectedValueIds.filter((id) => id !== v.id)
                                    : [...x.selectedValueIds, v.id],
                                },
                          ),
                        )
                      }
                      className={
                        "rounded-l-full border px-3 py-1 text-[12px] font-medium transition-colors " +
                        (splittable ? "" : "rounded-r-full ") +
                        (on
                          ? "border-ink-900 bg-ink-900 text-white"
                          : "border-ink-200 bg-white text-ink-700 hover:border-ink-400")
                      }
                    >
                      {v.label}
                    </button>
                    {splittable && (
                      <button
                        type="button"
                        title={`Split into ${splitComboValue(v.label).join(" + ")}`}
                        onClick={async () => {
                          // POST one new value per token; auto-tick each as
                          // it returns so the old combo chip can be
                          // untoggled afterward.
                          const parts = splitComboValue(v.label);
                          const created: { id: string; label: string }[] = [];
                          for (const p of parts) {
                            try {
                              const r = await fetch(
                                `/api/admin/attributes/${attr.id}/values`,
                                {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ value: p, sortOrder: 0 }),
                                },
                              );
                              if (!r.ok) continue;
                              const d = (await r.json()) as {
                                value: { id: string; value: string; displayLabel: string | null };
                              };
                              created.push({
                                id: d.value.id,
                                label: d.value.displayLabel ?? d.value.value,
                              });
                            } catch {
                              /* duplicate or transient — skip */
                            }
                          }
                          if (created.length === 0) return;
                          // Append to the catalog AND auto-tick on this
                          // axis. Untoggle the combo chip too.
                          setAttributes(
                            attributes.map((x) =>
                              x.id !== attr.id
                                ? x
                                : { ...x, values: [...x.values, ...created] },
                            ),
                          );
                          setAxes(
                            axes.map((x, idx) =>
                              idx !== i
                                ? x
                                : {
                                    ...x,
                                    selectedValueIds: [
                                      ...x.selectedValueIds.filter((id) => id !== v.id),
                                      ...created.map((c) => c.id),
                                    ],
                                  },
                            ),
                          );
                        }}
                        className={
                          "rounded-r-full border-y border-r px-1.5 py-1 text-[11px] font-bold transition-colors " +
                          (on
                            ? "border-ink-900 bg-ink-900 text-white hover:bg-ink-800"
                            : "border-ink-200 bg-white text-brand-700 hover:border-brand-400 hover:bg-brand-50")
                        }
                        aria-label="Split this combo into separate values"
                      >
                        ✂
                      </button>
                    )}
                  </span>
                );
              })}
              <button
                type="button"
                onClick={() => setValueAdderFor(attr.id)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand-300 bg-brand-50/40 px-2.5 py-0.5 text-[11.5px] font-semibold text-brand-700 hover:bg-brand-50"
              >
                <Plus className="h-3 w-3" /> Add value
              </button>
              {attr.values.length === 0 && (
                <span className="text-[11px] text-ink-400 italic">
                  No values yet. Click <b>Add value</b> to add the first one.
                </span>
              )}
            </div>
            {valueAdderFor === attr.id && (
              <ValueAdder
                attributeId={attr.id}
                onClose={() => setValueAdderFor(null)}
                onAdded={(created) => {
                  setAttributes(
                    attributes.map((x) =>
                      x.id !== attr.id ? x : { ...x, values: [...x.values, created] },
                    ),
                  );
                  // auto-tick the new value for this axis.
                  setAxes(
                    axes.map((x, idx) =>
                      idx !== i
                        ? x
                        : { ...x, selectedValueIds: [...x.selectedValueIds, created.id] },
                    ),
                  );
                  setValueAdderFor(null);
                }}
              />
            )}
          </div>
        );
      })}
      {available.length > 0 && (
        <label className="block">
          <span className="text-[12px] font-semibold text-ink-700">Add an axis</span>
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              setAxes([...axes, { attributeId: e.target.value, selectedValueIds: [] }]);
            }}
            className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
          >
            <option value="">— pick an attribute —</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.type})
              </option>
            ))}
          </select>
        </label>
      )}
      {!showCreate ? (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-brand-300 bg-brand-50/40 px-3 h-9 text-[12.5px] font-semibold text-brand-700 hover:bg-brand-50"
        >
          <Plus className="h-3.5 w-3.5" /> Create new attribute (e.g. Mandate, Core Subject, Elective 1)
        </button>
      ) : (
        <AttributeAdder
          allowedTypes={allowedTypes}
          onClose={() => setShowCreate(false)}
          onAdded={(attr) => {
            setAttributes([...attributes, attr]);
            setAxes([...axes, { attributeId: attr.id, selectedValueIds: [] }]);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function AttributeAdder({
  onClose,
  onAdded,
  allowedTypes,
}: {
  onClose: () => void;
  onAdded: (attr: AttributeOption) => void;
  /** Restrict the type select to a subset and default to its first member.
   *  Uniform passes `["size","color"]` → defaults to `size`. Bookkit
   *  passes everything except those → defaults to `other`. */
  allowedTypes?: AttributeOption["type"][];
}) {
  const defaultType: AttributeOption["type"] =
    allowedTypes && allowedTypes.length > 0 ? allowedTypes[0] : "other";
  const [name, setName] = useState("");
  const [type, setType] = useState<AttributeOption["type"]>(defaultType);
  const [initialValuesRaw, setInitialValuesRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allTypes: { value: AttributeOption["type"]; label: string }[] = [
    { value: "other", label: "other (use for Mandate / Core / Elective)" },
    { value: "size", label: "size" },
    { value: "color", label: "color" },
    { value: "design", label: "design" },
    { value: "model", label: "model" },
  ];
  const typeOptions = allowedTypes
    ? allTypes.filter((t) => allowedTypes.includes(t.value))
    : allTypes;

  async function save() {
    setErr(null);
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type, sortOrder: 0 }),
      });
      let attrId: string;
      let attrName = name.trim();
      let attrType: AttributeOption["type"] = type;
      let existingValues: { id: string; label: string }[] = [];
      if (r.status === 409) {
        // Name collision — reuse the existing row + fetch its current
        // values so the wizard transparently uses what's already there.
        const body = (await r.json()) as {
          error: string;
          existing: { id: string; name: string; type: string };
        };
        attrId = body.existing.id;
        attrName = body.existing.name;
        attrType = body.existing.type as AttributeOption["type"];
        try {
          const rv = await fetch(`/api/admin/attributes/${attrId}/values`, {
            cache: "no-store",
          });
          if (rv.ok) {
            const d = (await rv.json()) as {
              values: { id: string; value: string; displayLabel: string | null }[];
            };
            existingValues = d.values.map((v) => ({
              id: v.id,
              label: v.displayLabel ?? v.value,
            }));
          }
        } catch {
          // No big deal — the axis renders without ticked values and the
          // admin can add them via "Add value".
        }
        setErr(body.error);
      } else if (!r.ok) {
        const t = await r.text();
        throw new Error(t || "Create attribute failed");
      } else {
        const d = (await r.json()) as {
          attribute: { id: string; name: string; type: string };
        };
        attrId = d.attribute.id;
        attrName = d.attribute.name;
      }
      // Add any initial values the admin typed — same semantics for both
      // new and existing attribute paths. ValueAdder-style splitter for
      // each line so "Bio /CS" → ["Bio","CS"].
      const valueLabels: string[] = [];
      for (const line of initialValuesRaw.split(/\n/)) {
        valueLabels.push(...splitComboValue(line));
      }
      const createdValues: { id: string; label: string }[] = [];
      for (const v of valueLabels) {
        const rv = await fetch(`/api/admin/attributes/${attrId}/values`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: v, sortOrder: 0 }),
        });
        if (rv.ok) {
          const dd = (await rv.json()) as {
            value: { id: string; value: string; displayLabel: string | null };
          };
          createdValues.push({
            id: dd.value.id,
            label: dd.value.displayLabel ?? dd.value.value,
          });
        }
      }
      // De-dupe by id so an existing+typed value doesn't appear twice.
      const valuesById = new Map<string, { id: string; label: string }>();
      for (const v of [...existingValues, ...createdValues]) valuesById.set(v.id, v);
      onAdded({
        id: attrId,
        name: attrName,
        type: attrType,
        values: Array.from(valuesById.values()),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-bold text-ink-900">New attribute</p>
        <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-700">
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        autoFocus
        placeholder="Attribute name (e.g. Core Subject)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-ink-900"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as AttributeOption["type"])}
        className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-ink-900"
      >
        {typeOptions.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <textarea
        rows={3}
        placeholder={"Initial values, one per line — e.g.\nPhysics Chemistry Maths\nPhysics Chemistry Biology\nCommerce\nHumanities"}
        value={initialValuesRaw}
        onChange={(e) => setInitialValuesRaw(e.target.value)}
        className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-ink-900 font-mono"
      />
      {err && <p className="text-[11.5px] text-red-700">{err}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 h-8 text-[12.5px] font-semibold text-ink-700"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="inline-flex items-center gap-1 rounded-lg bg-ink-900 text-white px-3 h-8 text-[12.5px] font-bold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Create attribute"}
        </button>
      </div>
    </div>
  );
}

/** Detect any of `/`, `,`, `|` (with optional surrounding whitespace) and
 *  split into trimmed, non-empty tokens. Used by the ValueAdder so an
 *  admin pasting "Bio /CS" or "Biology, Computer Science" gets ONE
 *  catalog value per subject rather than a single combined chip. */
export function splitComboValue(input: string): string[] {
  return input
    .split(/[\/,|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function ValueAdder({
  attributeId,
  onClose,
  onAdded,
}: {
  attributeId: string;
  onClose: () => void;
  /** Called once per value created. The chip caller passes the same
   *  callback so each value gets auto-ticked on the parent axis. */
  onAdded: (created: { id: string; label: string }) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const parts = splitComboValue(value);
  const willSplit = parts.length > 1;

  async function save() {
    setErr(null);
    if (parts.length === 0) {
      setErr("Value is required.");
      return;
    }
    setBusy(true);
    try {
      for (const p of parts) {
        const r = await fetch(`/api/admin/attributes/${attributeId}/values`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: p, sortOrder: 0 }),
        });
        if (!r.ok) {
          // Continue past duplicates so the admin doesn't lose the
          // values that DID save; surface the first non-409-ish error.
          const t = await r.text();
          if (!/already|duplicate|unique/i.test(t)) {
            throw new Error(t || "Add value failed");
          }
          continue;
        }
        const d = (await r.json()) as {
          value: { id: string; value: string; displayLabel: string | null };
        };
        onAdded({ id: d.value.id, label: d.value.displayLabel ?? d.value.value });
      }
      setValue("");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-2 mt-2 space-y-1">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          placeholder="New value — or paste 'Bio / CS' to add both at once"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          className="flex-1 rounded border border-ink-200 bg-white px-2 py-1 text-[12.5px] outline-none focus:border-ink-900"
        />
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded bg-ink-900 text-white px-2.5 py-1 text-[12px] font-bold disabled:opacity-50"
        >
          {busy ? "…" : willSplit ? `Add ${parts.length}` : "Add"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-400 hover:text-ink-700"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {willSplit && (
        <p className="text-[10.5px] text-brand-700">
          Will create <b>{parts.length}</b> separate values: {parts.join(" · ")}
        </p>
      )}
      {err && <p className="text-[11px] text-red-700">{err}</p>}
    </div>
  );
}

export function VariantsMatrix({
  axesResolved,
  variants,
  setVariants,
}: {
  axesResolved: AxisDef[];
  variants: VariantRow[];
  setVariants: (v: VariantRow[]) => void;
}) {
  const update = (i: number, patch: Partial<VariantRow>) =>
    setVariants(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-[12.5px] text-ink-500">
        {variants.length} variant{variants.length === 1 ? "" : "s"} (cartesian
        product of all axes). Tweak SKU + opening stock per row before saving.
      </p>
      <table className="w-full text-[12.5px] min-w-[640px]">
        <thead className="text-left text-[10.5px] font-semibold tracking-wider uppercase text-ink-500">
          <tr>
            {axesResolved.map((a) => (
              <th key={a.attributeId} className="py-2 pr-3">
                {a.attributeName}
              </th>
            ))}
            <th className="py-2 pr-3">SKU</th>
            <th className="py-2 pr-3 w-24 text-right">Stock</th>
            <th className="py-2 pr-3 w-16 text-center">Active</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v, i) => {
            const labels = v.axisValueIds.map((vid) => {
              for (const a of axesResolved) {
                const x = a.values.find((vv) => vv.id === vid);
                if (x) return x.label;
              }
              return "?";
            });
            return (
              <tr key={i} className="border-t border-ink-100">
                {labels.map((l, j) => (
                  <td key={j} className="py-1.5 pr-3 text-ink-700">
                    {l}
                  </td>
                ))}
                <td className="py-1.5 pr-3">
                  <input
                    value={v.sku}
                    onChange={(e) => update(i, { sku: e.target.value })}
                    className="h-8 w-full px-2 rounded border border-ink-200 text-[12.5px] font-mono"
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="number"
                    min={0}
                    value={v.stockQty}
                    onChange={(e) =>
                      update(i, { stockQty: parseInt(e.target.value) || 0 })
                    }
                    className="h-8 w-full px-2 rounded border border-ink-200 text-[12.5px] text-right"
                  />
                </td>
                <td className="py-1.5 pr-3 text-center">
                  <input
                    type="checkbox"
                    checked={v.isActive}
                    onChange={(e) => update(i, { isActive: e.target.checked })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
