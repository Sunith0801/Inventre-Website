"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

// ════════════════════════════════════════════════════════════════════
// Button
// ════════════════════════════════════════════════════════════════════

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  busy,
  icon,
  iconRight,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  /** Pre-rendered React element (e.g. <Plus className="h-3.5 w-3.5" />) — accepts elements, not component refs (RSC boundary). */
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}) {
  const sizes = {
    sm: "h-8 px-3 text-[12px]",
    md: "h-9 px-4 text-[13px]",
    lg: "h-11 px-5 text-[14px]",
  } as const;
  const variants: Record<BtnVariant, string> = {
    primary:
      "bg-ink-900 text-white border border-ink-900 hover:bg-ink-800 active:scale-[0.98] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
    secondary:
      "bg-white text-ink-900 border border-ink-200 hover:bg-cream-100 active:bg-cream-200 hover:border-ink-300",
    ghost:
      "bg-transparent text-ink-700 hover:bg-ink-100/70 hover:text-ink-900 border border-transparent",
    danger:
      "bg-red-600 text-white border border-red-700 hover:bg-red-700 active:scale-[0.98] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
  };
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-[background,border,box-shadow,transform] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-1",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        sizes[size],
        variants[variant],
        className
      )}
    >
      {busy ? (
        <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
      ) : (
        icon ?? null
      )}
      {children}
      {iconRight ?? null}
    </button>
  );
}

export function IconBtn({
  icon,
  label,
  tone: t = "default",
  size = "md",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Pre-rendered icon element (e.g. <Pencil className="h-4 w-4" />). */
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "danger";
  size?: "sm" | "md";
}) {
  return (
    <button
      {...rest}
      aria-label={label}
      className={cn(
        "grid place-items-center rounded-lg transition-colors",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        t === "danger"
          ? "text-ink-500 hover:bg-red-50 hover:text-red-600"
          : "text-ink-500 hover:bg-ink-100/70 hover:text-ink-900",
        rest.className
      )}
    >
      {icon}
    </button>
  );
}
