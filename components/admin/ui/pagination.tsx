/**
 * Table pagination for the admin panel.
 *
 * Server-renderable: every control is a link, so paging works with JavaScript
 * still loading and the browser's back button walks the pages. The Users and
 * Orders screens were each growing their own copy of this; it lives here now.
 *
 * Two things this does that a bare Prev/Next pair does not:
 *
 *   1. Disabled controls HOLD THEIR PLACE at the first and last page. When
 *      they unmount instead, the remaining button slides under the cursor and
 *      the next click lands on the wrong control.
 *   2. It states the record range. "Page 3 of 25" does not answer the
 *      question an operator actually has, which is "which of the 1,204 am I
 *      looking at" — so it reads "Showing 101–150 of 1,204".
 */

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

const arrowSkin = (enabled: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
    enabled
      ? "border-ink-200 bg-white text-ink-800 hover:bg-cream-100 hover:border-ink-300"
      : "border-ink-100 bg-cream-50 text-ink-300 cursor-not-allowed"
  );

export function Pagination({
  page,
  pages,
  from,
  to,
  total,
  /** Builds the href for a given page number. */
  hrefFor,
  /** Rendered on the right of the range readout — typically a per-page picker. */
  children,
  /** Singular noun for the range readout, e.g. "user". */
  noun = "record",
  className,
}: {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  hrefFor: (page: number) => string;
  children?: React.ReactNode;
  noun?: string;
  className?: string;
}) {
  const n = (v: number) => v.toLocaleString("en-IN");
  const hasPrev = page > 1;
  const hasNext = page < pages;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-4 py-2.5",
        className
      )}
    >
      <div className="flex items-center gap-4">
        <p className="text-[12.5px] text-ink-500 tabular-nums">
          {total === 0 ? (
            <>No {noun}s</>
          ) : (
            <>
              Showing{" "}
              <span className="font-semibold text-ink-800">
                {n(from)}–{n(to)}
              </span>{" "}
              of {n(total)} {total === 1 ? noun : `${noun}s`}
            </>
          )}
        </p>
        {children}
      </div>

      {pages > 1 ? (
        <div className="flex items-center gap-1.5">
          {hasPrev ? (
            <Link href={hrefFor(page - 1)} className={arrowSkin(true)} rel="prev">
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Link>
          ) : (
            <span className={arrowSkin(false)} aria-disabled="true">
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </span>
          )}

          <span className="px-2 text-[12.5px] text-ink-500 tabular-nums">
            Page <span className="font-semibold text-ink-800">{n(page)}</span> of {n(pages)}
          </span>

          {hasNext ? (
            <Link href={hrefFor(page + 1)} className={arrowSkin(true)} rel="next">
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className={arrowSkin(false)} aria-disabled="true">
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}

/**
 * Per-page picker. Links rather than a <select> so it stays server-renderable
 * and does not need a client island purely to navigate.
 */
export function PerPagePicker({
  value,
  options,
  hrefFor,
}: {
  value: number;
  options: readonly number[];
  hrefFor: (perPage: number) => string;
}) {
  return (
    <div className="flex items-center gap-1 text-[12.5px] text-ink-500">
      <span className="hidden sm:inline">Rows</span>
      <div className="flex items-center rounded-lg border border-ink-200 bg-white p-0.5">
        {options.map((opt) => {
          const active = opt === value;
          return (
            <Link
              key={opt}
              href={hrefFor(opt)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "rounded-md px-2 py-0.5 font-semibold tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-cream-100 hover:text-ink-900"
              )}
            >
              {opt}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
