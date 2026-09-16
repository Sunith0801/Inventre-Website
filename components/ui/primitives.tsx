/**
 * Inventre Storefront — design system primitives (airy density).
 *
 * The second of the two densities. `@/components/admin/ui/primitives` is the
 * compact one: 13px type, 36px controls, 2xl cards, square-ish corners, built
 * for staff who look at four hundred rows a day. This file is the outward
 * face: 15px type, 44–56px controls, full-round pills, generous padding.
 *
 * Both read the SAME tokens out of `tailwind.config.ts` — brand / ink / cream,
 * Plus Jakarta via `font-display`. There is no second palette and no second
 * typeface. A density is a spacing-and-radius decision, not a re-theme.
 *
 * Every recipe here is transcribed from `docs/design/DESIGN_SYSTEM.md`, which
 * was itself reverse-engineered from the hand-designed homepage. This file is
 * that spec made executable: previously the spec said "primary CTA is an
 * orange pill with these nine classes" and 59 storefront buttons each typed
 * those nine classes out by hand, drifting one from the next.
 *
 * NO "use client" — pure presentational, so server components render them
 * directly. Anything needing an event handler is passed in by the caller.
 */

import * as React from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

// ════════════════════════════════════════════════════════════════════
// Container & section rhythm
// ════════════════════════════════════════════════════════════════════

/** The page gutter. Every storefront section sits in one of these. */
export function Container({
  children,
  width = "default",
  className,
}: {
  children: React.ReactNode;
  /** `narrow` = prose/FAQ (max-w-4xl), `default` = everything else. */
  width?: "default" | "narrow" | "prose";
  className?: string;
}) {
  const w = { default: "max-w-7xl", narrow: "max-w-4xl", prose: "max-w-2xl" }[width];
  return <div className={cn("mx-auto px-5 lg:px-8", w, className)}>{children}</div>;
}

/**
 * Vertical rhythm + the cream/cream-200 alternation. The spec's rule is that
 * two `cream-200` sections must never sit back to back; `surface` makes the
 * choice explicit at the call site so that is visible in a diff.
 */
export function Section({
  children,
  surface = "cream",
  size = "default",
  className,
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  children: React.ReactNode;
  surface?: "cream" | "alt" | "ink" | "none";
  size?: "default" | "compact" | "strip";
}) {
  const surfaces = {
    cream: "bg-cream",
    alt: "bg-cream-200 border-y border-ink-100",
    ink: "bg-ink-900 text-cream",
    none: "",
  };
  const sizes = {
    default: "py-20 lg:py-28",
    compact: "py-12 lg:py-16",
    strip: "py-8 lg:py-12",
  };
  return (
    <section {...rest} className={cn(surfaces[surface], sizes[size], className)}>
      {children}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Eyebrow & section heading
// ════════════════════════════════════════════════════════════════════

/**
 * The pill eyebrow — dot + spaced uppercase label. The spec calls this the
 * stronger of the two variants and prefers it for hero and marquee sections;
 * `variant="text"` is the quieter one.
 */
export function Eyebrow({
  children,
  variant = "pill",
  onDark,
  className,
}: {
  children: React.ReactNode;
  variant?: "pill" | "text";
  onDark?: boolean;
  className?: string;
}) {
  const label = "font-display text-[12px] font-semibold tracking-[0.18em] uppercase";
  if (variant === "text") {
    return <div className={cn(label, onDark ? "text-brand-300" : "text-brand", className)}>{children}</div>;
  }
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5",
        onDark ? "bg-white/10 border border-white/20" : "bg-brand-50 border border-brand-100",
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
      <span className={cn(label, onDark ? "text-brand-300" : "text-brand-700")}>{children}</span>
    </div>
  );
}

/**
 * Eyebrow → H2 → caption, with the optional right-aligned "View all" link
 * that the spec pairs with the left-aligned variant.
 */
export function SectionHeading({
  eyebrow,
  title,
  caption,
  align = "left",
  action,
  onDark,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  caption?: React.ReactNode;
  align?: "left" | "center";
  action?: React.ReactNode;
  onDark?: boolean;
  className?: string;
}) {
  const block = (
    <div className={cn(align === "center" ? "text-center max-w-2xl mx-auto" : "max-w-2xl")}>
      {eyebrow ? <Eyebrow onDark={onDark}>{eyebrow}</Eyebrow> : null}
      <h2
        className={cn(
          "mt-3 font-display font-extrabold text-display-md",
          onDark ? "text-white" : "text-ink-900"
        )}
      >
        {title}
      </h2>
      {caption ? (
        <p className={cn("mt-5 text-[16px] leading-relaxed", onDark ? "text-white/70" : "text-ink-600")}>
          {caption}
        </p>
      ) : null}
    </div>
  );
  if (!action) return <div className={className}>{block}</div>;
  return (
    <div className={cn("flex items-end justify-between gap-6 flex-wrap", className)}>
      {block}
      <div className="flex-shrink-0">{action}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Button
// ════════════════════════════════════════════════════════════════════

type StoreVariant = "primary" | "secondary" | "ghost" | "onDark";

const buttonSizes = {
  sm: "h-10 px-4 text-[13px]",
  md: "h-12 px-6 text-[14px]",
  lg: "h-14 px-8 text-[15px]",
} as const;

const buttonVariants: Record<StoreVariant, string> = {
  // Orange pill — the one primary action on a page.
  primary:
    "bg-brand text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-brand-600 active:scale-[0.98]",
  // Dark pill — the companion action next to a primary.
  secondary: "bg-ink-900 text-cream hover:bg-ink-700",
  // Outline on cream.
  ghost: "border border-ink-200 bg-white text-ink-800 hover:border-ink-900",
  // The ghost equivalent when sitting on an ink-900 panel.
  onDark: "border border-white/20 bg-white/5 backdrop-blur text-white hover:bg-white/10",
};

const buttonBase = cn(
  "group inline-flex items-center justify-center gap-2 rounded-full font-semibold",
  "transition-all duration-200",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
);

/**
 * Storefront button. Renders `<button>` by default; pass `href` and it
 * renders a next/link with the identical skin, so a CTA never has to choose
 * between looking right and navigating right.
 */
export function Button({
  variant = "primary",
  size = "md",
  busy,
  icon,
  iconRight,
  href,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: StoreVariant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  icon?: React.ReactNode;
  /** Trailing glyph. The spec translates it 0.5 on hover — that is done here. */
  iconRight?: React.ReactNode;
  href?: string;
}) {
  const skin = cn(buttonBase, buttonSizes[size], buttonVariants[variant], className);
  const inner = (
    <>
      {busy ? (
        <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-r-transparent animate-spin" />
      ) : (
        icon ?? null
      )}
      {children}
      {iconRight ? (
        <span className="transition-transform group-hover:translate-x-0.5">{iconRight}</span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={skin}>
        {inner}
      </Link>
    );
  }
  return (
    <button {...rest} disabled={busy || rest.disabled} className={skin}>
      {inner}
    </button>
  );
}

/** The small circular icon button — nav, card corners, close affordances. */
export function CircleButton({
  icon,
  label,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode; label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      className={cn(
        "grid h-10 w-10 place-items-center rounded-full text-ink-800",
        "hover:text-brand hover:bg-brand-50 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        className
      )}
    >
      {icon}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════
// Form controls
// ════════════════════════════════════════════════════════════════════

const storeControl =
  "w-full bg-white text-ink-900 placeholder:text-ink-400 outline-none transition-colors " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

const storeBorder = (invalid?: boolean) =>
  invalid ? "border border-red-400 focus:border-red-500" : "border border-ink-200 focus:border-ink-900";

/**
 * Two shapes, per the spec: `pill` for prominent outward-facing fields (hero
 * search, newsletter) and `field` for inputs inside a card or form.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { shape?: "field" | "pill"; invalid?: boolean }
>(function Input({ shape = "field", invalid, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      {...rest}
      aria-invalid={invalid || undefined}
      className={cn(
        storeControl,
        storeBorder(invalid),
        shape === "pill"
          ? "rounded-full px-5 py-4 text-[15px] font-medium"
          : "rounded-xl px-4 py-3 text-[14px]",
        className
      )}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { shape?: "field" | "pill"; invalid?: boolean }
>(function Select({ shape = "field", invalid, className, children, ...rest }, ref) {
  const pill = shape === "pill";
  return (
    <div className="relative">
      <select
        ref={ref}
        {...rest}
        aria-invalid={invalid || undefined}
        className={cn(
          storeControl,
          storeBorder(invalid),
          "appearance-none cursor-pointer",
          pill ? "rounded-full pl-5 pr-12 py-4 text-[15px] font-medium" : "rounded-xl pl-4 pr-10 py-3 text-[14px]",
          className
        )}
      >
        {children}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-ink-500",
          pill ? "right-5" : "right-3.5"
        )}
      />
    </div>
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ invalid, className, rows = 5, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...rest}
      aria-invalid={invalid || undefined}
      className={cn(storeControl, storeBorder(invalid), "rounded-xl px-4 py-3 text-[14px] leading-relaxed resize-y", className)}
    />
  );
});

/** Label + hint + error, airy spacing. Mirrors the admin `Field` API exactly. */
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
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block mb-2 text-[12px] font-semibold text-ink-700">
          {label}
          {required ? <span className="text-brand ml-0.5">*</span> : null}
        </label>
      ) : null}
      {React.isValidElement(children) && describedBy
        ? React.cloneElement(children as React.ReactElement<{ "aria-describedby"?: string }>, {
            "aria-describedby": describedBy,
          })
        : children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-[12px] font-medium text-red-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-[12px] text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The form-wide error banner. */
export function FormError({ children, className }: { children?: React.ReactNode; className?: string }) {
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

// ════════════════════════════════════════════════════════════════════
// Cards
// ════════════════════════════════════════════════════════════════════

/**
 * Card type 1 from the spec — the light feature card. `interactive` adds the
 * brand border and lifted shadow on hover; leave it off for a plain panel.
 */
export function Card({
  children,
  interactive,
  className,
}: {
  children: React.ReactNode;
  interactive?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative rounded-2xl border border-ink-100 bg-white p-6 lg:p-7",
        interactive &&
          "hover:border-brand hover:shadow-[0_20px_40px_-22px_rgba(228,113,39,0.25)] transition-all",
        className
      )}
    >
      {children}
    </div>
  );
}

/** The signature brand icon tile that sits at the top of a feature card. */
export function IconTile({
  icon,
  size = "md",
  dot,
  className,
}: {
  icon: React.ReactNode;
  size?: "md" | "lg";
  /** The corner dot used on the HowItWorks tiles. */
  dot?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative grid place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand",
        "group-hover:bg-brand group-hover:text-white transition-all",
        size === "lg" ? "h-14 w-14" : "h-12 w-12",
        className
      )}
    >
      {icon}
      {dot ? (
        <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-cream" />
      ) : null}
    </div>
  );
}

/** The faint oversized ordinal ("01", "02") in a feature card's top-right. */
export function Ordinal({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "font-display text-[40px] font-extrabold leading-none text-brand-50",
        "group-hover:text-brand-100 transition-colors",
        className
      )}
    >
      {children}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// Badge
// ════════════════════════════════════════════════════════════════════

export function Badge({
  children,
  variant = "outline",
  className,
}: {
  children: React.ReactNode;
  /** Per the spec's three in-card badge recipes. */
  variant?: "outline" | "brand" | "glass" | "success" | "danger";
  className?: string;
}) {
  const variants = {
    outline: "border border-ink-200 text-ink-500",
    brand: "bg-brand text-white",
    glass: "bg-white/85 backdrop-blur border border-white text-ink-800",
    success: "bg-emerald-50 border border-emerald-200 text-emerald-700",
    danger: "bg-red-50 border border-red-200 text-red-700",
  }[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        "text-[10px] font-bold tracking-[0.14em] uppercase",
        variants,
        className
      )}
    >
      {children}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// Empty state
// ════════════════════════════════════════════════════════════════════

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-center py-16 px-6", className)}>
      {icon ? (
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand">
          {icon}
        </div>
      ) : null}
      <h3 className="mt-5 font-display text-[20px] font-bold text-ink-900">{title}</h3>
      {description ? (
        <p className="mt-2 text-[14px] text-ink-500 max-w-md mx-auto leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
