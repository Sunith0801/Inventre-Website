"use client";

/**
 * Modal dialog + the confirmation variant, for the admin panel.
 *
 * Sensitive administrative actions — locking an account, resetting someone's
 * password, a bulk change across fifty rows — need a deliberate second step.
 * That step is only worth anything if it states WHAT is about to happen to
 * WHICH records, so `ConfirmDialog` takes a description and renders the
 * destructive verb on the button rather than a generic "OK".
 *
 * ── What a correct dialog owes the keyboard ─────────────────────────────
 *   - focus moves INTO the dialog on open (first focusable, or the confirm
 *     button — never left behind on the trigger)
 *   - Tab cycles within the dialog and cannot escape to the page behind
 *   - Escape closes, unless a request is in flight
 *   - focus RETURNS to whatever opened it on close
 *   - the page behind does not scroll
 *
 * Most hand-rolled admin modals implement the first of those and none of the
 * rest, which is why keyboard users end up tabbing through an invisible page
 * underneath an open dialog.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "./primitives-client";
import { cn } from "@/lib/cn";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  /** Blocks Escape and the backdrop while a request is in flight. */
  busy,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  busy?: boolean;
  width?: "sm" | "md" | "lg";
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreTo = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descId = React.useId();

  // Remember the trigger, move focus in, and give it back on close.
  React.useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => restoreTo.current?.focus?.();
  }, [open]);

  // The page behind a modal must not scroll under it.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;

    // Focus trap: wrap at both ends of the dialog's own focusables.
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open || typeof document === "undefined") return null;

  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:p-6"
      onKeyDown={onKeyDown}
    >
      <div
        className="fixed inset-0 bg-ink-900/40 backdrop-blur-[2px]"
        onClick={() => !busy && onClose()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative mt-[10vh] w-full rounded-2xl border border-ink-100 bg-white",
          "shadow-[0_32px_80px_-24px_rgba(10,10,10,0.35)]",
          widths[width]
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <h2 id={titleId} className="text-[16px] font-bold tracking-tight text-ink-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-7 w-7 place-items-center rounded-lg text-ink-400 hover:bg-ink-100/70 hover:text-ink-900 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {description ? (
          <p id={descId} className="px-5 pt-2 text-[13px] leading-relaxed text-ink-600">
            {description}
          </p>
        ) : null}

        {children ? <div className="px-5 pt-4">{children}</div> : null}

        {footer ? (
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

/**
 * Confirmation for a destructive or wide-reaching action.
 *
 * `error` is rendered inside the dialog rather than as a toast: when the
 * server refuses ("at least one active Super Admin must remain"), the reason
 * belongs next to the button that was refused, where the operator is already
 * looking.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  busy,
  error,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  error?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            busy={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error ? (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </Dialog>
  );
}
