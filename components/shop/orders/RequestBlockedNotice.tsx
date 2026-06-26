"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { isApprovedStatus } from "@/lib/exchange-shared";

/**
 * Popup shown when a parent opens the Exchange / Missing form for a sale
 * order that already has an open (or approved) request — the cross-flow
 * lifetime lock. Renders in place of the form so the parent can't even
 * start filling it in. On close we send them back to the order page.
 *
 *   • Approved (or beyond) → permanent block, business-rule wording.
 *   • Still pending        → "in progress, please wait" wording.
 *
 * `flow` is the page the parent is ON; `existingKind` is what already
 * exists (they can differ — an open exchange blocks the missing page and
 * vice-versa).
 */
export function RequestBlockedNotice({
  flow,
  existingKind,
  existingStatus,
  orderHref,
}: {
  flow: "exchange" | "missing";
  existingKind: "exchange" | "missing";
  existingStatus: string;
  orderHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  const existingLabel = existingKind === "exchange" ? "Exchange" : "Missing";
  const approved = isApprovedStatus(existingStatus);
  const heading = approved
    ? `${existingLabel} request already approved`
    : `${existingLabel} request in progress`;
  const message = approved
    ? `An ${existingLabel} request has already been approved for this Sales Order. You cannot raise another request for this order.`
    : `A${
        existingKind === "exchange" ? "n Exchange" : " Missing"
      } request is already in progress for this Sales Order. Please wait for it to be processed before raising ${
        flow === existingKind ? "another" : `a${flow === "exchange" ? "n exchange" : " missing"}`
      } request.`;

  const back = () => {
    setOpen(false);
    router.replace(orderHref);
  };

  return (
    <Modal open={open} onClose={back} title={heading}>
      <div className="p-7">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
            <AlertCircle className="h-5 w-5" />
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
