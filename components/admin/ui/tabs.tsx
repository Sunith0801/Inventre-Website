/**
 * Tabs for admin detail pages.
 *
 * Server-renderable and URL-driven: each tab is a link carrying `?tab=`, not
 * a piece of client state. That buys three things a `useState` version does
 * not — a tab is linkable and can be sent to a colleague, the back button
 * steps between tabs, and a tab's contents are fetched on the server only
 * when that tab is actually open, so an eight-tab page does not issue eight
 * queries to render one.
 *
 * `count` renders a badge — a "Users" tab that says how many is answering the
 * question before the operator has to click it.
 */

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export type TabItem = {
  /** Value written to the `tab` query parameter. */
  key: string;
  label: string;
  count?: number;
  /** Pre-rendered glyph. */
  icon?: React.ReactNode;
};

export function Tabs({
  tabs,
  active,
  hrefFor,
  className,
}: {
  tabs: TabItem[];
  active: string;
  hrefFor: (key: string) => string;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-ink-100", className)}>
      {/* Scrolls rather than wraps: a wrapped second row of tabs reads as a
          separate control, and the underline no longer lines up with the
          content it belongs to. */}
      <nav
        className="-mb-px flex items-center gap-1 overflow-x-auto no-scrollbar"
        aria-label="Sections"
      >
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <Link
              key={t.key}
              href={hrefFor(t.key)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-1",
                on
                  ? "border-brand text-ink-900"
                  : "border-transparent text-ink-500 hover:border-ink-200 hover:text-ink-800"
              )}
            >
              {t.icon}
              {t.label}
              {typeof t.count === "number" ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums",
                    on ? "bg-brand-50 text-brand-700" : "bg-ink-100 text-ink-500"
                  )}
                >
                  {t.count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Reads the active tab from `searchParams`, falling back to the first tab
 * when the value is absent or not one this page offers — a stale or
 * hand-edited `?tab=` should show the default section, not an empty page.
 */
export function resolveTab(
  raw: string | string[] | undefined,
  tabs: readonly TabItem[]
): string {
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return tabs.some((t) => t.key === value) ? value : (tabs[0]?.key ?? "");
}
