"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
  mandatesByAxis,
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
  /** Read-only "Mandate Subjects" chip row, rendered immediately after
   *  the matching parent axis. When the parent axis has a value picked,
   *  chips show the subjects that auto-ship with that value (e.g. Stream
   *  = Science → Physics, Chemistry, Physical Education). Parents can't
   *  click these — they always go in the box. */
  mandatesByAxis?: {
    axisName: string;
    subjectsByValue: Record<string, string[]>;
  };
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

  // Resolve a selection → variantId. Pure, called both from useEffect on
  // mount and synchronously from pick() so a rapid Add-to-Cart click after
  // a size click never reads a stale pickedVariantId in the parent.
  const resolveSelection = (sel: Record<string, string>) => {
    const isComplete = groups.every((g) => Boolean(sel[g.name]));
    if (!isComplete) {
      onResolve(null);
    } else {
      const key = buildAttributeKey(sel);
      onResolve(variantsByAttributeKey[key] ?? null);
    }
    onSelectionChange?.(sel);
  };

  // Initial / external-change resolution. Pick handler resolves
  // synchronously below, so this effect's job is the mount-time pass and
  // any external prop-driven change.
  useEffect(() => {
    resolveSelection(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantsByAttributeKey, groups]);

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
    const next: Record<string, string> = { ...selection, [axisName]: value };
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
    setSelection(next);
    // Resolve synchronously — don't wait for the useEffect tick to flush
    // onResolve to the parent. If the user clicks Add to Cart before the
    // effect runs, the parent's pickedVariantId could otherwise still be
    // the previous selection's variant (root cause of the picker-30-but-
    // cart-shows-28 symptom observed 2026-06-04).
    resolveSelection(next);
  };

  const mandateAxisName = mandatesByAxis?.axisName;
  const hasMandates =
    !!mandateAxisName &&
    Object.keys(mandatesByAxis?.subjectsByValue ?? {}).length > 0;

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
        const showMandateAfter =
          hasMandates && mandateAxisName === group.name;
        const pickedMandateValue = showMandateAfter ? value : undefined;
        const mandateChips =
          showMandateAfter && pickedMandateValue
            ? mandatesByAxis!.subjectsByValue[pickedMandateValue] ?? []
            : [];
        return (
          <Fragment key={group.name}>
          <div
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
                // When the axis already has a value picked, ALL chips on
                // that axis stay clickable — switching is the natural way
                // to fix a mistake. `pick()` already handles cascading
                // cleanup of now-invalid downstream picks. Without this
                // guard the picker locked parents into their first stream
                // because unreachable-but-clickable chips were
                // permanently disabled once any downstream axis was set.
                const hasOwnPick = value !== undefined;
                const allowSwitch = hasOwnPick && !active;
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={(fixed && active) || (!reachable && !active && !allowSwitch)}
                    title={
                      !reachable && !active
                        ? allowSwitch
                          ? "Switch to this value — your later picks will reset if they don't combine."
                          : "Not available with the current selection"
                        : undefined
                    }
                    onClick={() => pick(group.name, v)}
                    className={
                      "h-10 px-3.5 rounded-md border text-[13px] font-semibold transition-all " +
                      (active
                        ? "bg-ink-900 text-white border-ink-900"
                        : reachable
                          ? "bg-white text-ink-800 border-ink-200 hover:border-ink-900"
                          : allowSwitch
                            ? "bg-white text-ink-500 border-ink-200 border-dashed hover:border-ink-900 hover:text-ink-800"
                            : "bg-cream-50 text-ink-300 border-ink-100 line-through cursor-not-allowed")
                    }
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
          {showMandateAfter && (
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-900">
                Mandate Subjects
                <span className="ml-2 text-[10px] font-medium tracking-normal normal-case text-ink-400">
                  {pickedMandateValue
                    ? `· ships with ${pickedMandateValue}`
                    : `· pick ${group.name} above to see`}
                </span>
              </p>
              {mandateChips.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {mandateChips.map((subject) => (
                    <span
                      key={subject}
                      title="Ships with your kit — not selectable"
                      className="h-10 px-3.5 inline-flex items-center rounded-md border text-[13px] font-semibold bg-ink-900/5 text-ink-700 border-ink-200 cursor-default"
                    >
                      {subject}
                    </span>
                  ))}
                </div>
              ) : pickedMandateValue ? (
                <p className="mt-2 text-[12px] text-ink-400 italic">
                  No mandate subjects configured for {pickedMandateValue}.
                </p>
              ) : null}
            </div>
          )}
          </Fragment>
        );
      })}
    </div>
  );
}
