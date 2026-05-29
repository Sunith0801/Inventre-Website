"use client";

import { Minus, Plus } from "lucide-react";

export function QtyStepper({
  value,
  onChange,
  min = 1,
  max = 10,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="inline-flex items-center rounded-full border border-ink-200 bg-white">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="grid h-11 w-11 place-items-center text-ink-700 hover:text-brand disabled:text-ink-300 disabled:cursor-not-allowed transition-colors"
      >
        <Minus className="h-4 w-4" strokeWidth={2.2} />
      </button>
      <span
        className="w-10 text-center font-display text-[16px] font-bold tabular-nums text-ink-900 select-none"
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="grid h-11 w-11 place-items-center text-ink-700 hover:text-brand disabled:text-ink-300 disabled:cursor-not-allowed transition-colors"
      >
        <Plus className="h-4 w-4" strokeWidth={2.2} />
      </button>
    </div>
  );
}
