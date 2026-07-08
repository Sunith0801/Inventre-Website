"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

/**
 * A greyed-out Exchange / Missing entry button that the customer can still
 * click — clicking explains WHY the request can't be raised in a popup
 * (Conditions 1, 2 & 4):
 *   • the 10-day request window has expired, or
 *   • a request has already been raised for this Sales Order (optionally by
 *     the Customer Care Team).
 *
 * We deliberately do NOT set the native `disabled` attribute — the button
 * must stay clickable so the popup can fire; `aria-disabled` conveys the
 * state to assistive tech and the styling reads as disabled.
 */
export function BlockedRequestButton({
  label,
  message,
}: {
  label: string;
  message: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-[12.5px] font-medium text-ink-400 opacity-80 hover:border-ink-300"
      >
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        <div className="p-7">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
              <AlertCircle className="h-5 w-5" />
            </span>
            <p className="text-[14px] leading-relaxed text-ink-600">{message}</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="mt-6 w-full rounded-xl bg-ink-900 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-ink-800"
          >
            OK
          </button>
        </div>
      </Modal>
    </>
  );
}
