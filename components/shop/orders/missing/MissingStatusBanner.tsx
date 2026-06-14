"use client";

/**
 * Status banner shown at the top of an order-detail page when there is a
 * missing-item claim open against this order. Mirrors ExchangeStatusBanner
 * (same look & wording style) but for the missing-claim status machine:
 *
 *   requested → approved → received_at_school → delivered
 *   requested → rejected (terminal)
 *
 * Renders nothing if there is no active claim. Visible only to allowlisted
 * parents — the gate is upstream (the API only returns `activeMissing` for
 * testers).
 */

import { CheckCircle2, AlertCircle, Clock, Package } from "lucide-react";
import { formatPickupLabel } from "@/lib/exchange-shared";

type ActiveMissing = {
  id: string;
  claimNumber: string | null;
  status: string;
  pickupDate: string | null;
  createdAt: string;
};

export function MissingStatusBanner({
  orderId,
  activeMissing,
}: {
  orderId: string;
  activeMissing: ActiveMissing | null;
}) {
  if (!activeMissing) return null;

  const { id, claimNumber, status, pickupDate } = activeMissing;

  const link = `/shop/orders/${orderId}/missing/${id}`;

  if (status === "requested") {
    return (
      <a
        href={link}
        className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 hover:bg-amber-100/60"
      >
        <Clock className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <p className="font-display text-[14px] font-bold text-amber-900">
            Missing-item claim submitted{claimNumber ? ` · ${claimNumber}` : ""}
          </p>
          <p className="text-amber-800 mt-0.5">
            Approval is pending. We&apos;ll notify you as soon as our team reviews
            it.
          </p>
        </div>
      </a>
    );
  }

  if (status === "approved") {
    const pickupLabel = pickupDate ? formatPickupLabel(pickupDate) : null;
    return (
      <a
        href={link}
        className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 hover:bg-emerald-100/60"
      >
        <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <p className="font-display text-[14px] font-bold text-emerald-900">
            Missing-item claim approved{claimNumber ? ` · ${claimNumber}` : ""}
          </p>
          <p className="text-emerald-800 mt-0.5">
            The replacement is on its way to your school. Please visit on{" "}
            <span className="font-semibold">
              {pickupLabel ?? "the scheduled Saturday"}
            </span>{" "}
            to collect it. Carry a photo of this order so the school can verify.
          </p>
        </div>
      </a>
    );
  }

  if (status === "received_at_school") {
    return (
      <a
        href={link}
        className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 hover:bg-emerald-100/60"
      >
        <Package className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <p className="font-display text-[14px] font-bold text-emerald-900">
            Replacement arrived at school{claimNumber ? ` · ${claimNumber}` : ""}
          </p>
          <p className="text-emerald-800 mt-0.5">
            Your replacement has reached the school and is ready for collection.
          </p>
        </div>
      </a>
    );
  }

  if (status === "rejected") {
    return (
      <a
        href={link}
        className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 hover:bg-rose-100/60"
      >
        <AlertCircle className="h-5 w-5 text-rose-500 mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <p className="font-display text-[14px] font-bold text-rose-900">
            Missing-item claim not approved
            {claimNumber ? ` · ${claimNumber}` : ""}
          </p>
          <p className="text-rose-800 mt-0.5">
            Tap to see why and what to do next.
          </p>
        </div>
      </a>
    );
  }

  if (status === "delivered") {
    return (
      <a
        href={link}
        className="mt-4 flex items-start gap-3 rounded-2xl border border-ink-200 bg-cream-100 p-4 hover:bg-cream-200/60"
      >
        <Package className="h-5 w-5 text-ink-500 mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <p className="font-display text-[14px] font-bold text-ink-900">
            Missing-item claim completed
            {claimNumber ? ` · ${claimNumber}` : ""}
          </p>
          <p className="text-ink-600 mt-0.5">
            The replacement was handed over at school. Thanks for shopping with
            Inventre.
          </p>
        </div>
      </a>
    );
  }

  return null;
}
