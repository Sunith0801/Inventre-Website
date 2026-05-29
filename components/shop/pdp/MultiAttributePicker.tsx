"use client";

import { useEffect, useMemo, useState } from "react";
import { buildAttributeKey } from "@/lib/attribute-key";

export type AttributeGroup = { name: string; values: string[] };

/**
 * For each axis, which values pair with the current selection in some
 * real variant SKU? Walks the variant map (the same set the picker uses
 * for resolution) and intersects against the user's current picks.
 *
 * An axis already in `selection` returns the full set (we don't want to
 * disable the user's own chosen value retroactively). An unfilled axis
 * returns only values that, combined with the filled axes, still leave
 * at least one variant key reachable.
 */
function computeAvailableByAxis(
  selection: Record<string, string>,
  variantMap: Record<string, string>,
  groups: AttributeGroup[]
): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {};
  for (const g of groups) result[g.name] = new Set();

  for (const key of Object.keys(variantMap)) {
    let pairs: [string, string][];
    try {
      pairs = JSON.parse(key) as [string, string][];
    } catch {
      continue;
    }
    const tuple = Object.fromEntries(pairs);
    let matches = true;
    for (const [axis, value] of Object.entries(selection)) {
      // The axis under consideration is filtered separately below — when
      // we project values for axis X, we don't constrain by X's current
      // value (otherwise picking X would shrink X itself to one option).
      // The conjunction must hold for every OTHER picked axis.
      if (tuple[axis] !== value) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    for (const g of groups) {
      const v = tuple[g.name];
      if (v != null) result[g.name].add(v);
    }
  }

  // For each axis, also recompute "available" as the union of variant
  // values reachable when ignoring that axis's own current pick — so
  // changing the pick doesn't blank the chip strip.
  for (const g of groups) {
    if (!selection[g.name]) continue;
    const projected = new Set<string>();
    for (const key of Object.keys(variantMap)) {
      let pairs: [string, string][];
      try {
        pairs = JSON.parse(key) as [string, string][];
      } catch {
        continue;
      }
      const tuple = Object.fromEntries(pairs);
      let ok = true;
      for (const [axis, value] of Object.entries(selection)) {
        if (axis === g.name) continue;
        if (tuple[axis] !== value) {
          ok = false;
          break;
        }
      }
      if (ok && tuple[g.name] != null) projected.add(tuple[g.name]);
    }
    result[g.name] = projected;
  }

  return result;
}

/**
 * Multi-axis variant picker used by Item-Variant template PDPs (e.g.
 * SMS Grade 11 Bookkit with Mandate × Core × Elective axes).
 *
 * Behaviour:
 *  - Renders one stacked section per axis.
 *  - Single-value axes ("Mandate") are auto-picked and shown as a
 *    confirmed chip; the user can't change them.
 *  - Multi-value axes are shown in `groups` order; the first unfilled
 *    multi-value axis is visually highlighted; later axes are disabled
 *    until the prior axes are picked (progressive disclosure).
 *  - Whenever the selection covers every axis, looks up the resolved
 *    variant id via the parent-supplied `variantsByAttributeKey` map and
 *    calls `onResolve(variantId)`. When the selection is partial, calls
 *    `onResolve(null)` so the parent can disable Add to cart.
 *
 * The parent (BuyBox) owns the Add-to-cart button — this picker only
 * reports the resolved variant.
 */
export function MultiAttributePicker({
  groups,
  variantsByAttributeKey,
  onResolve,
  initialSelection: externalInitial,
  onSelectionChange,
}: {
  groups: AttributeGroup[];
  variantsByAttributeKey: Record<string, string>;
  onResolve: (variantId: string | null) => void;
  /** Restore from a saved draft. Only values still reachable in the
   *  current `variantsByAttributeKey` are honoured; unreachable picks
   *  are silently dropped so we never resolve to a missing variant. */
  initialSelection?: Record<string, string>;
  /** Fires on every pick. Used by the PDP draft-saver. */
  onSelectionChange?: (selection: Record<string, string>) => void;
}) {
  // Build initial selection: external draft picks first (when present and
  // still reachable), then auto-pick any axis with a single value.
  const initialSelection = useMemo(() => {
    const sel: Record<string, string> = {};
    for (const g of groups) {
      if (g.values.length === 1) sel[g.name] = g.values[0];
    }
    if (externalInitial) {
      for (const g of groups) {
        const v = externalInitial[g.name];
        if (v && g.values.includes(v)) sel[g.name] = v;
      }
    }
    return sel;
    // externalInitial is intentionally not a dep — the PDP only passes
    // the restored draft on mount; re-seeding mid-session would clobber
    // the parent's manual edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const [selection, setSelection] = useState<Record<string, string>>(initialSelection);

  // Compute the resolved variant id whenever selection / map changes.
  useEffect(() => {
    const isComplete = groups.every((g) => Boolean(selection[g.name]));
    if (!isComplete) {
      onResolve(null);
    } else {
      const key = buildAttributeKey(selection);
      onResolve(variantsByAttributeKey[key] ?? null);
    }
    onSelectionChange?.(selection);
    // onResolve / onSelectionChange identities can flap; we only want to
    // fire on real selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, variantsByAttributeKey, groups]);

  // Index of the first unfilled multi-value axis — anything after this
  // is disabled until the user fills it.
  const firstUnfilledIdx = groups.findIndex(
    (g) => g.values.length > 1 && !selection[g.name]
  );

  const availableByAxis = useMemo(
    () => computeAvailableByAxis(selection, variantsByAttributeKey, groups),
    [selection, variantsByAttributeKey, groups]
  );

  // When the user changes an earlier axis, downstream picks may no
  // longer match any real variant. Clear those automatically so the
  // UI reflects an internally consistent selection (and the resolver
  // never reports a non-existent combination).
  const pick = (axisName: string, value: string) => {
    setSelection((cur) => {
      const next: Record<string, string> = { ...cur, [axisName]: value };
      // Re-validate every other axis against the new selection. If a
      // previously-picked value is no longer reachable, drop it.
      const newAvail = computeAvailableByAxis(next, variantsByAttributeKey, groups);
      for (const g of groups) {
        if (g.name === axisName) continue;
        const v = next[g.name];
        if (v && !newAvail[g.name].has(v)) {
          delete next[g.name];
        }
      }
      return next;
    });
  };

  return (
    <div className="mt-7 space-y-5">
      {groups.map((group, idx) => {
        const fixed = group.values.length === 1;
        const value = selection[group.name];
        const locked =
          !fixed &&
          firstUnfilledIdx !== -1 &&
          idx > firstUnfilledIdx;
        const avail = availableByAxis[group.name] ?? new Set<string>();
        return (
          <div
            key={group.name}
            className={locked ? "opacity-50 pointer-events-none" : ""}
          >
            <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-900">
              {group.name}
              {fixed && (
                <span className="ml-2 text-[10px] font-medium tracking-normal normal-case text-ink-400">
                  · auto-selected
                </span>
              )}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {group.values.map((v) => {
                const active = value === v;
                const reachable = avail.has(v);
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={(fixed && active) || (!reachable && !active)}
                    title={
                      !reachable && !active
                        ? "Not available with the current selection"
                        : undefined
                    }
                    onClick={() => pick(group.name, v)}
                    className={
                      "h-10 px-3.5 rounded-md border text-[13px] font-semibold transition-all " +
                      (active
                        ? "bg-ink-900 text-white border-ink-900"
                        : reachable
                          ? "bg-white text-ink-800 border-ink-200 hover:border-ink-900"
                          : "bg-cream-50 text-ink-300 border-ink-100 line-through cursor-not-allowed")
                    }
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
