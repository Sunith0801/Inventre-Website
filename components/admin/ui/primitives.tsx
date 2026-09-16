/**
 * Inventre Admin — Design System Primitives (server-renderable).
 *
 * NO "use client" here — these are pure presentational primitives that
 * server components can use freely (and pass Lucide icons / other component
 * props into without RSC boundary errors).
 *
 * Interactive bits (Button with onClick, IconBtn) live in `./primitives-client`.
 * Both files re-export everything via this same module path:
 *   import { PageHeader, Stat, Card, Button, ... } from "@/components/admin/ui/primitives";
 *
 * Aesthetic: Linear/Stripe/Vercel-tier. Cream/ink/brand from existing tokens.
 */

import * as React from "react";
import Link from "next/link";
import { navSections, sectionHref } from "@/lib/admin-nav";
import { ChevronRight, Search, Inbox, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";

// Re-export client-only primitives so all imports work from one path.
export { Button, IconBtn } from "./primitives-client";

// Form controls (server-renderable) — same single import path.
export {
  Field,
  Input,
  Select,
  Textarea,
  Checkbox,
  Radio,
  FormGrid,
  FormActions,
  FormError,
} from "./form";
export type { ControlSize } from "./form";

// Overlay + navigation primitives.
export { FilterSelect } from "./filter-select";
export { DateField } from "./date-field";
export { Menu } from "./menu";
export type { MenuItem } from "./menu";
export { Pagination, PerPagePicker } from "./pagination";

// ════════════════════════════════════════════════════════════════════
// Primary color helpers (semantic mappings to existing tokens)
// ════════════════════════════════════════════════════════════════════

export const tone = {
  default: "bg-ink-100 text-ink-700",
  subtle: "bg-cream-200 text-ink-700",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-700",
  violet: "bg-violet-50 text-violet-700",
} as const;

export type Tone = keyof typeof tone;

// ════════════════════════════════════════════════════════════════════
// Page Header
// ════════════════════════════════════════════════════════════════════

export function PageHeader({
  eyebrow,
  title,
  description,
  breadcrumb,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  actions?: React.ReactNode;
}) {
  // The trail always starts at the section the page belongs to, taken from
  // the eyebrow — "Customer Relationship (CRM) › Students › Sitara" — so a
  // breadcrumb reads like the sidebar hierarchy and every level is a link.
  const eyebrowSection = eyebrow ? navSections.find((sec) => sec.kicker === eyebrow) : undefined;
  const trail =
    breadcrumb && breadcrumb.length > 0 && eyebrowSection && breadcrumb[0]?.label !== eyebrowSection.kicker
      ? [{ label: eyebrowSection.kicker, href: sectionHref(eyebrowSection) }, ...breadcrumb]
      : breadcrumb;
  return (
    <header className="mb-6 lg:mb-8">
      {trail && trail.length > 0 ? (
        <nav className="flex flex-wrap items-center gap-1 text-[12px] text-ink-500 mb-2">
          {trail.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {b.href ? (
                <Link href={b.href} className="hover:text-ink-900 transition-colors">
                  {b.label}
                </Link>
              ) : (
                <span>{b.label}</span>
              )}
              {i < trail.length - 1 ? (
                <ChevronRight className="h-3 w-3 text-ink-300" />
              ) : null}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          {eyebrow && !(trail && trail.length > 0 && eyebrowSection) ? (
            // The eyebrow is the section this page belongs to. When a
            // breadcrumb already starts with that section it is not repeated. When it names a
            // sidebar section it is a link to that section's landing page —
            // the same way the logo is a link home — so "Pricing & Taxation"
            // above "Payment Surcharges" takes you back to the section's
            // modules. Anything else (e.g. "Modules") stays plain text.
            (() => {
              const section = navSections.find((sec) => sec.kicker === eyebrow);
              const cls = "text-[11px] font-semibold tracking-[0.14em] uppercase text-brand-600 mb-1";
              return section ? (
                <Link
                  href={sectionHref(section)}
                  className={cn(cls, "inline-block rounded transition-colors hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300")}
                >
                  {eyebrow}
                </Link>
              ) : (
                <div className={cls}>{eyebrow}</div>
              );
            })()
          ) : null}
          <h1 className="text-[26px] lg:text-[32px] font-bold tracking-tight text-ink-900 leading-[1.15]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 text-[14px] text-ink-500 max-w-2xl leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2 flex-shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}

// ════════════════════════════════════════════════════════════════════
// Card
// ════════════════════════════════════════════════════════════════════

export function Card({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-ink-100/70 bg-white shadow-[0_1px_2px_rgba(10,10,10,0.04)]",
        padded && "p-5 lg:p-6",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 mb-4", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink-900 leading-tight">{title}</h3>
        {description ? (
          <p className="text-[12px] text-ink-500 mt-0.5">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2 flex-shrink-0">{actions}</div> : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Stat
// ════════════════════════════════════════════════════════════════════

export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  iconTone = "brand",
  trend,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  iconTone?: Tone;
  trend?: { dir: "up" | "down" | "flat"; label: string };
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-ink-100/70 bg-white p-4 lg:p-5 shadow-[0_1px_2px_rgba(10,10,10,0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500">
          {label}
        </div>
        {Icon ? (
          <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", tone[iconTone])}>
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      {/* A long rupee total ("₹14,63,74,626.16") in a half-width phone card
          ran past the card edge: smaller type below `sm`, and wrap rather
          than overflow if it still does not fit. */}
      <div className="mt-2 text-[24px] sm:text-[28px] lg:text-[30px] font-bold tracking-tight text-ink-900 tabular-nums leading-none [overflow-wrap:anywhere]">
        {value}
      </div>
      {hint || trend ? (
        <div className="mt-2 flex items-center gap-2 text-[12px]">
          {trend ? (
            <span
              className={cn(
                "font-semibold",
                trend.dir === "up" && "text-emerald-700",
                trend.dir === "down" && "text-red-700",
                trend.dir === "flat" && "text-ink-500"
              )}
            >
              {trend.dir === "up" ? "↑ " : trend.dir === "down" ? "↓ " : "— "}
              {trend.label}
            </span>
          ) : null}
          {hint ? <span className="text-ink-500">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Badge / Status pill
// ════════════════════════════════════════════════════════════════════

export function Badge({
  children,
  tone: t = "default",
  size = "md",
  dot,
  className,
  title,
}: {
  children: React.ReactNode;
  tone?: Tone;
  size?: "sm" | "md";
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium rounded-full",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-[12px]",
        tone[t],
        className
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" /> : null}
      {children}
    </span>
  );
}

/** Map common Inventre statuses to a tone. */
export function statusTone(s: string | null | undefined): Tone {
  if (!s) return "default";
  const x = s.toLowerCase();
  if (["delivered", "paid", "active", "approved", "completed", "submitted", "shipped"].includes(x))
    return "success";
  if (["confirmed", "packed", "out_for_delivery"].includes(x)) return "info";
  if (["placed", "draft", "pending", "requested"].includes(x)) return "subtle";
  if (["overdue", "cancelled", "failed", "rejected", "blocked"].includes(x)) return "danger";
  if (["returned", "refunded", "partly_paid", "partially_paid"].includes(x)) return "violet";
  if (["onboarding", "received"].includes(x)) return "warning";
  return "default";
}

// ════════════════════════════════════════════════════════════════════
// Toolbar (top of list pages)
// ════════════════════════════════════════════════════════════════════

export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 mb-4 p-2 rounded-xl bg-white border border-ink-100/70",
        className
      )}
    >
      {children}
    </div>
  );
}

export function FilterChips({
  options,
  value,
  baseHref,
  paramName = "status",
}: {
  options: { value: string | null; label: string; tone?: Tone }[];
  value: string | null | undefined;
  baseHref: string;
  paramName?: string;
}) {
  return (
    <div className="flex items-center gap-1 text-[12px]">
      {options.map((o) => {
        const active = (value ?? null) === o.value;
        const href = o.value
          ? `${baseHref}?${paramName}=${encodeURIComponent(o.value)}`
          : baseHref;
        return (
          <Link
            key={o.label}
            href={href}
            className={cn(
              "px-2.5 py-1.5 rounded-lg font-medium transition-colors",
              active
                ? "bg-ink-900 text-white"
                : "text-ink-600 hover:bg-cream-100 hover:text-ink-900"
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Search input
// ════════════════════════════════════════════════════════════════════

export function SearchInput({
  defaultValue,
  placeholder = "Search…",
  name = "q",
  className,
}: {
  defaultValue?: string;
  placeholder?: string;
  name?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex-1 min-w-[200px]", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400 pointer-events-none" />
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full h-9 pl-9 pr-3 text-[13px] rounded-lg bg-cream-50 border border-ink-100 placeholder:text-ink-400 focus:outline-none focus:bg-white focus:border-ink-300 focus:ring-2 focus:ring-brand-300/40 transition-[background,border,box-shadow]"
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// DataTable wrapper
// ════════════════════════════════════════════════════════════════════

export function DataTable({
  children,
  className,
  empty,
  scroll = true,
}: {
  children: React.ReactNode;
  className?: string;
  empty?: React.ReactNode;
  /**
   * Wide admin tables must scroll sideways on a narrow screen rather than
   * clip. The card keeps `overflow-hidden` so the 2xl corners still round;
   * the inner rail is what actually scrolls. Before this existed every
   * table simply lost its right-hand columns below ~900px.
   *
   * Pass `scroll={false}` for a card whose content is not a <table> and
   * genuinely must overflow visibly (a popover anchored to a row).
   */
  scroll?: boolean;
}) {
  const body = empty ?? children;
  return (
    <div className={cn("rounded-2xl border border-ink-100/70 bg-white overflow-hidden", className)}>
      {scroll ? <div className="overflow-x-auto">{body}</div> : body}
    </div>
  );
}

export const Th = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { right?: boolean }
>(function Th({ children, right, className, ...rest }, ref) {
  return (
    <th
      ref={ref}
      {...rest}
      className={cn(
        // Base look comes from the global admin table rules (globals.css);
        // the primitive only carries alignment so bare <th>s match it.
        right ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </th>
  );
});

export const Td = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean; muted?: boolean }
>(function Td({ children, right, muted, className, ...rest }, ref) {
  return (
    <td
      ref={ref}
      {...rest}
      className={cn(
        right ? "text-right tabular-nums" : "text-left",
        // `muted` dims a secondary column; the first column is already bold
        // and dark via the global table rules.
        muted ? "!text-ink-500 !font-normal" : "",
        className
      )}
    >
      {children}
    </td>
  );
});

/**
 * Table row. Pass `href` to make the first cell render as a Link that fills
 * the cell — gives whole-row "looks-clickable" feel while keeping the markup
 * server-renderable (no client-only window.location dance).
 *
 * In practice: pages just wrap the primary cell content in <Link href=...>.
 * This component is a thin styling wrapper.
 */
export function Tr({
  children,
  className,
}: {
  children: React.ReactNode;
  href?: string; // accepted but ignored — kept for source compatibility; pages should add their own Link
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "group",
        className
      )}
    >
      {children}
    </tr>
  );
}

/** Wrap a cell's content in a Link that visually fills the cell. */
export function CellLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 hover:text-brand-700 transition-colors",
        className
      )}
    >
      {children}
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════
// Empty state
// ════════════════════════════════════════════════════════════════════

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-cream-100 text-ink-400 mb-3">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
      {description ? (
        <p className="text-[13px] text-ink-500 mt-1 max-w-xs">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Skeleton
// ════════════════════════════════════════════════════════════════════

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md bg-gradient-to-r from-cream-100 via-cream-200 to-cream-100 bg-[length:200%_100%] animate-[shimmer_1.4s_infinite]",
        className
      )}
      style={{
        backgroundImage: "linear-gradient(90deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.07) 50%, rgba(0,0,0,0.04) 100%)",
        animation: "shimmer 1.4s infinite",
      }}
    />
  );
}

// ════════════════════════════════════════════════════════════════════
// Section divider with kicker
// ════════════════════════════════════════════════════════════════════

export function SectionTitle({
  children,
  description,
  actions,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-3">
      <div>
        <h2 className="text-[13px] font-semibold text-ink-900 tracking-tight">{children}</h2>
        {description ? <p className="text-[12px] text-ink-500 mt-0.5">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Money + Number display
// ════════════════════════════════════════════════════════════════════

export function Money({
  paise,
  fallback = "—",
  className,
}: {
  paise: number | null | undefined;
  fallback?: string;
  className?: string;
}) {
  if (paise == null) return <span className={cn("text-ink-400", className)}>{fallback}</span>;
  return (
    <span className={cn("tabular-nums", className)}>
      ₹{(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// External link
// ════════════════════════════════════════════════════════════════════

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-0.5 text-brand-700 hover:text-brand-800 hover:underline underline-offset-2",
        className
      )}
    >
      {children}
      <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}
