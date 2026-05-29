"use client";

import { Phone } from "lucide-react";

export function MobileInput({
  value,
  onChange,
  error,
  autoFocus,
  id = "mobile",
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoFocus?: boolean;
  id?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-800">
        Mobile number
      </label>
      <div
        className={
          "mt-2 flex items-stretch rounded-xl border bg-white overflow-hidden transition-colors focus-within:border-ink-900 " +
          (error ? "border-red-400" : "border-ink-200")
        }
      >
        <span className="inline-flex items-center gap-1.5 px-3 border-r border-ink-200 bg-cream-100 text-[14px] font-semibold text-ink-700">
          <Phone className="h-3.5 w-3.5 text-ink-500" />
          +91
        </span>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          autoFocus={autoFocus}
          maxLength={10}
          placeholder="98xxxxxxxx"
          value={value}
          onChange={(e) =>
            onChange(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
          className="flex-1 px-3 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 outline-none bg-transparent tabular-nums tracking-wider"
        />
      </div>
      {error && (
        <p className="mt-1.5 text-[12px] font-medium text-red-500">{error}</p>
      )}
    </div>
  );
}
