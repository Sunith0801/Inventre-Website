import Link from "next/link";
import { cn } from "@/lib/cn";
import type { Probe } from "@/server/admin/system-status";

/**
 * A single row of "is it up?" dots — database, cache, ERP bridge, SMS,
 * email. Sits under the page header on the dashboard and the Settings hub.
 * Deliberately terse: a dot, a name, one word of detail. Anything that
 * needs a paragraph belongs on the module's own page, which the item links to.
 */
export type StatusItem = {
  label: string;
  probe: Probe;
  detail?: string;
  href?: string;
};

const DOT: Record<Probe, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  down: "bg-red-500",
  off: "bg-ink-300",
};

const TEXT: Record<Probe, string> = {
  ok: "text-ink-700",
  warn: "text-amber-800",
  down: "text-red-700",
  off: "text-ink-500",
};

export function StatusStrip({ items, className }: { items: StatusItem[]; className?: string }) {
  return (
    <ul
      className={cn(
        "mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-ink-100/70 bg-white px-4 py-2.5 text-[12px]",
        className,
      )}
    >
      {items.map((it) => {
        const body = (
          <>
            <span className="relative flex h-2 w-2 shrink-0">
              {it.probe === "down" || it.probe === "warn" ? (
                <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", DOT[it.probe])} />
              ) : null}
              <span className={cn("relative inline-flex h-2 w-2 rounded-full", DOT[it.probe])} />
            </span>
            <span className="font-medium text-ink-900">{it.label}</span>
            {it.detail ? <span className={cn("tabular-nums", TEXT[it.probe])}>{it.detail}</span> : null}
          </>
        );
        return (
          <li key={it.label} className="flex items-center gap-2">
            {it.href ? (
              <Link href={it.href} className="flex items-center gap-2 rounded transition-colors hover:text-brand-700">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
