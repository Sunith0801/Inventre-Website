"use client";

import { FilterSelect } from "@/components/admin/ui/filter-select";
import { DateField } from "@/components/admin/ui/date-field";

/**
 * Period preset + From/To dates for an AutoSubmitForm toolbar, kept mutually
 * exclusive: picking a preset clears the dates, and entering a date clears
 * the preset. Before, a preset silently overrode the dates while both still
 * showed as selected, so picking a date appeared to do nothing.
 *
 * The clearing runs in `onInput`, which fires on the control before the
 * form's own onInput submit, so what gets submitted is already consistent.
 * Pair it with a `key` on the form (from the values the server used) so the
 * pills re-render with the settled state after navigation.
 */
export function PeriodRangeFields({
  preset,
  from,
  to,
  presets,
  presetName = "dateRange",
  allLabel = "All time",
}: {
  preset: string;
  from: string;
  to: string;
  presets: { value: string; label: string }[];
  presetName?: string;
  allLabel?: string;
}) {
  const clear = (form: HTMLFormElement | null, names: string[]) => {
    if (!form) return;
    for (const name of names) {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = "";
    }
  };

  return (
    <>
      <FilterSelect
        label="Period"
        allLabel={allLabel}
        name={presetName}
        defaultValue={preset}
        onInput={(e) => {
          if (e.currentTarget.value) clear(e.currentTarget.form, ["from", "to"]);
        }}
      >
        {presets.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </FilterSelect>
      <DateField
        label="From"
        name="from"
        defaultValue={from}
        max={to || undefined}
        onInput={(e) => {
          if (e.currentTarget.value) clear(e.currentTarget.form, [presetName]);
        }}
      />
      <DateField
        label="To"
        name="to"
        defaultValue={to}
        min={from || undefined}
        onInput={(e) => {
          if (e.currentTarget.value) clear(e.currentTarget.form, [presetName]);
        }}
      />
    </>
  );
}
