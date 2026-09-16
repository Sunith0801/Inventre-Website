import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * DateField — a labelled date input for list/report toolbars: "From ▢".
 * Same pill shape as FilterSelect so a toolbar of dropdowns and dates reads
 * as one row of controls. Server-renderable; works inside AutoSubmitForm.
 */
export function DateField({
  label,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = rest.id ?? `date-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex h-9 items-stretch overflow-hidden rounded-lg border border-ink-100 bg-white text-[13px] transition-[border,box-shadow] focus-within:border-ink-300 focus-within:ring-2 focus-within:ring-brand-300/40",
        rest.disabled && "opacity-60",
        className
      )}
    >
      <span className="flex shrink-0 items-center whitespace-nowrap border-r border-ink-100 bg-cream-50 px-2.5 text-[12px] font-medium text-ink-500">
        {label}
      </span>
      <input
        id={id}
        type="date"
        {...rest}
        className="h-full min-w-0 bg-transparent px-2.5 text-[13px] text-ink-900 outline-none disabled:cursor-not-allowed"
      />
    </label>
  );
}
