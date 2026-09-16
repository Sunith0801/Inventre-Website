"use client";

import * as React from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * FilterSelect — a labelled dropdown for list toolbars: "Verified: All ▾".
 *
 * The filter's NAME is a fixed prefix inside the control, the closed control
 * reads "All" while nothing is chosen, and the open list shows ONLY the
 * values ("Yes", "No") — "All" is the empty state, not a choice. Clearing is
 * the small × that appears once a value is picked.
 *
 * Works both ways it is used in the admin: inside an AutoSubmitForm (plain
 * `name` + `defaultValue`, the form listens for input events) and as a
 * controlled React select (`value` + `onChange`). The × sets the native
 * select back to "" and fires the same events a user's pick would, so both
 * paths react to it.
 */
export const FilterSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    /** The filter's name, shown as the prefix. */
    label: string;
    /** Text shown while nothing is chosen. Defaults to "All". */
    allLabel?: string;
    /** Omit the empty state (for filters that always carry a value). */
    noAll?: boolean;
  }
>(function FilterSelect({ label, allLabel = "All", noAll, className, children, onChange, ...rest }, forwardedRef) {
  const innerRef = React.useRef<HTMLSelectElement | null>(null);
  const setRefs = (el: HTMLSelectElement | null) => {
    innerRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };
  const id = rest.id ?? `filter-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const controlled = rest.value !== undefined;
  const [current, setCurrent] = React.useState<string>(String(rest.value ?? rest.defaultValue ?? ""));
  React.useEffect(() => {
    if (controlled) setCurrent(String(rest.value ?? ""));
  }, [controlled, rest.value]);

  const clear = () => {
    const el = innerRef.current;
    if (!el) return;
    el.value = "";
    setCurrent("");
    // The same events a real pick fires: `input` for AutoSubmitForm, `change`
    // for React's onChange on a controlled select.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const hasValue = !noAll && current !== "";

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex h-9 max-w-[300px] items-stretch overflow-hidden rounded-lg border bg-white text-[13px] transition-[border,box-shadow] focus-within:border-ink-300 focus-within:ring-2 focus-within:ring-brand-300/40",
        hasValue ? "border-brand-300" : "border-ink-100",
        rest.disabled && "opacity-60",
        className
      )}
    >
      <span className="flex shrink-0 items-center whitespace-nowrap border-r border-ink-100 bg-cream-50 px-2.5 text-[12px] font-medium text-ink-500">
        {label}
      </span>
      <span className="relative flex min-w-0 flex-1 items-center">
        <select
          ref={setRefs}
          id={id}
          {...rest}
          onChange={(e) => {
            if (!controlled) setCurrent(e.target.value);
            onChange?.(e);
          }}
          className={cn(
            "h-full w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pl-2.5 text-[13px] outline-none disabled:cursor-not-allowed",
            hasValue ? "pr-12 font-medium text-ink-900" : "pr-7 text-ink-700"
          )}
        >
          {/* The empty state. `hidden` keeps it out of the open list while the
              closed control can still display it. */}
          {noAll ? null : <option value="" hidden>{allLabel}</option>}
          {children}
        </select>
        {hasValue ? (
          <button
            type="button"
            onClick={clear}
            aria-label={`Clear ${label}`}
            title="Clear"
            className="absolute right-6 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-800"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
      </span>
    </label>
  );
});
