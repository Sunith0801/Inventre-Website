/**
 * Inventre Admin — form primitives (compact density).
 *
 * NO "use client" — these are pure presentational wrappers over the native
 * form elements, so server components can render them directly. They take
 * every native prop through `...rest`, which is what lets an existing page
 * swap a hand-rolled `<input className="…">` for `<Input />` without
 * touching its `name`, `defaultValue`, `required` or server-action wiring.
 *
 * Why this file exists: the admin had `Card`, `Badge`, `DataTable` and the
 * rest, but nothing at all for form controls — so 414 `<input>` and 145
 * `<select>` elements each carried their own hand-typed class string. The
 * same input recipe appeared verbatim 14 times. One field style lives here
 * now, and the focus ring is the same on every control in the panel.
 *
 * Density: compact (h-9 / 13px), matching `SearchInput` and `Button` in
 * ./primitives. The airy storefront equivalents live in @/components/ui.
 *
 * Import from the one path, same as the other primitives:
 *   import { Field, Input, Select } from "@/components/admin/ui/primitives";
 */

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The shared control shell. Every text-like control and the select trigger
 * use this, so a focus ring or border tweak is a one-line change here
 * rather than a sweep across the panel.
 */
const control =
  "w-full rounded-lg border bg-cream-50 text-ink-900 placeholder:text-ink-400 " +
  "transition-[background,border,box-shadow] " +
  "focus:outline-none focus:bg-white focus:ring-2 focus:ring-brand-300/40 " +
  "disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-ink-50";

/** Invalid fields get the red border without needing a wrapper to know. */
const borderFor = (invalid?: boolean) =>
  invalid
    ? "border-red-300 focus:border-red-400 focus:ring-red-200/50"
    : "border-ink-100 focus:border-ink-300";

const sizes = {
  sm: "h-8 px-2.5 text-[12px]",
  md: "h-9 px-3 text-[13px]",
  lg: "h-11 px-3.5 text-[14px]",
} as const;

export type ControlSize = keyof typeof sizes;

// ════════════════════════════════════════════════════════════════════
// Field — label + hint + error wrapper
// ════════════════════════════════════════════════════════════════════

/**
 * Wraps one control with its label, hint and error message, and wires the
 * `htmlFor` / `aria-describedby` relationship that 216 hand-written labels
 * across the panel mostly did not have.
 *
 * Pass `htmlFor` matching the control's `id`. When the control is a single
 * child, prefer `<Field label="…" htmlFor="sku"><Input id="sku" /></Field>`.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  /** Quiet helper text under the control. Hidden when `error` is set. */
  hint?: React.ReactNode;
  /** Error message. Replaces the hint and colours the label row. */
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="block mb-1.5 text-[12px] font-semibold text-ink-700"
        >
          {label}
          {required ? <span className="text-brand ml-0.5">*</span> : null}
        </label>
      ) : null}
      {/* The control reads the describedBy id off the wrapper via cloneElement
          only when it is a single element — otherwise callers wire it
          themselves, which keeps this component free of child assumptions. */}
      {React.isValidElement(children) && describedBy
        ? React.cloneElement(children as React.ReactElement<{ "aria-describedby"?: string }>, {
            "aria-describedby": describedBy,
          })
        : children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-[12px] font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-[11.5px] text-ink-500 leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Input
// ════════════════════════════════════════════════════════════════════

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    inputSize?: ControlSize;
    invalid?: boolean;
    /** Renders a leading glyph inside the field (a pre-rendered element). */
    icon?: React.ReactNode;
  }
>(function Input({ inputSize = "md", invalid, icon, className, ...rest }, ref) {
  const field = (
    <input
      ref={ref}
      {...rest}
      aria-invalid={invalid || undefined}
      className={cn(
        control,
        borderFor(invalid),
        sizes[inputSize],
        icon && "pl-9",
        // Number fields in the admin are typed, not spun — the browser
        // spinners cause accidental increments on hover mid-entry.
        rest.type === "number" && "no-spin",
        className
      )}
    />
  );
  if (!icon) return field;
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none">
        {icon}
      </span>
      {field}
    </div>
  );
});

// ════════════════════════════════════════════════════════════════════
// Select
// ════════════════════════════════════════════════════════════════════

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    selectSize?: ControlSize;
    invalid?: boolean;
  }
>(function Select({ selectSize = "md", invalid, className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        {...rest}
        aria-invalid={invalid || undefined}
        className={cn(
          control,
          borderFor(invalid),
          sizes[selectSize],
          "appearance-none pr-8 cursor-pointer",
          className
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
    </div>
  );
});


// ════════════════════════════════════════════════════════════════════
// Textarea
// ════════════════════════════════════════════════════════════════════

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ invalid, className, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...rest}
      aria-invalid={invalid || undefined}
      className={cn(control, borderFor(invalid), "px-3 py-2.5 text-[13px] leading-relaxed resize-y", className)}
    />
  );
});

// ════════════════════════════════════════════════════════════════════
// Checkbox / Radio
// ════════════════════════════════════════════════════════════════════

/**
 * Checkbox with its label as one click target. `label` is the visible text;
 * everything else passes to the native input, so `name`/`defaultChecked`
 * keep working inside plain form actions.
 */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
    label?: React.ReactNode;
    hint?: React.ReactNode;
  }
>(function Checkbox({ label, hint, className, ...rest }, ref) {
  return (
    <label className={cn("flex items-start gap-2.5 cursor-pointer select-none group", className)}>
      <input
        ref={ref}
        type="checkbox"
        {...rest}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-200 text-brand accent-brand cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-300/40 disabled:opacity-60 disabled:cursor-not-allowed"
      />
      {label || hint ? (
        <span className="min-w-0">
          {label ? (
            <span className="block text-[13px] font-medium text-ink-800 group-hover:text-ink-900">
              {label}
            </span>
          ) : null}
          {hint ? <span className="block text-[11.5px] text-ink-500 leading-relaxed">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  );
});

export const Radio = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: React.ReactNode }
>(function Radio({ label, className, ...rest }, ref) {
  return (
    <label className={cn("flex items-center gap-2.5 cursor-pointer select-none", className)}>
      <input
        ref={ref}
        type="radio"
        {...rest}
        className="h-4 w-4 shrink-0 border-ink-200 accent-brand cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-300/40"
      />
      {label ? <span className="text-[13px] font-medium text-ink-800">{label}</span> : null}
    </label>
  );
});

// ════════════════════════════════════════════════════════════════════
// Layout helpers
// ════════════════════════════════════════════════════════════════════

/**
 * The admin's form grid. Admin forms are overwhelmingly two-column on
 * desktop and must stack on a phone; `cols` picks the desktop count.
 */
export function FormGrid({
  cols = 2,
  children,
  className,
}: {
  cols?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const at = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
  }[cols];
  return <div className={cn("grid gap-4", at, className)}>{children}</div>;
}

/** Right-aligned action row that stacks full-width on a phone. */
export function FormActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-4 border-t border-ink-100/70",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Form-wide error banner — the one at the top of a failed submit. */
export function FormError({ children, className }: { children: React.ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700",
        className
      )}
    >
      {children}
    </div>
  );
}
