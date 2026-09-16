"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarX2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { windowClosedMessage } from "@/lib/exchange-shared";

/**
 * Popup shown when a parent opens the Exchange / Missing form after the
 * 7-day post-delivery window has closed (counted from the day the LAST item
 * of the order arrived). Renders in place of the form; closing it sends them
 * back to the order page. Mirrors RequestBlockedNotice.
 */
export function RequestWindowClosedNotice({
  flow,
  expiresAt,
  orderHref,
}: {
  flow: "exchange" | "missing";
  /** ISO string — the exclusive cut-off instant from computeReturnsWindow. */
  expiresAt: string;
  orderHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  const heading =
    flow === "exchange" ? "Exchange period has ended" : "Missing-item claim period has ended";
  const message = windowClosedMessage(flow, expiresAt);

  const back = () => {
    setOpen(false);
    router.replace(orderHref);
  };

  return (
    <Modal open={open} onClose={back} title={heading}>
      <div className="p-7">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
            <CalendarX2 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-[18px] font-bold text-ink-900">
              {heading}
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-600">
              {message}
            </p>
          </div>
        </div>
        <button
          onClick={back}
          className="mt-6 w-full rounded-xl bg-ink-900 py-3 text-[14px] font-semibold text-white hover:bg-ink-800 transition-colors"
        >
          Back to order
        </button>
      </div>
    </Modal>
  );
}
