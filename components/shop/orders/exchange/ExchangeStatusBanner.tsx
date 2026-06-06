"use client";

/**
 * Status banner shown at the top of an order-detail page when there is
 * an exchange request open against this order. Renders nothing if no
 * active exchange. Visible only to allowlisted parents — the gate is
 * upstream (the API only returns `activeExchange` for testers).
 */

import { CheckCircle2, AlertCircle, Clock, Package } from "lucide-react";
import { formatPickupLabel } from "@/lib/exchange-shared";

type ActiveExchange = {
  id: string;
  returnNumber: string | null;
  status: string;
  pickupDate: string | null;
  createdAt: string;
};

export function ExchangeStatusBanner({
  orderId,
  activeExchange,
}: {
  orderId: string;
  activeExchange: ActiveExchange | null;
}) {
  if (!activeExchange) return null;

  const { id, returnNumber, status, pickupDate } = activeExchange;

  const link = `/shop/orders/${orderId}/exchange/${id}`;

  if (status === "requested") {
    return (
      <a
        href={link}
        className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 hover:bg-amber-100/60"
      >
        <Clock className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <p className="font-display text-[14px] font-bold text-amber-900">
            Exchange request submitted{returnNumber ? ` · ${returnNumber}` : ""}
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
            Exchange approved{returnNumber ? ` · ${returnNumber}` : ""}
          </p>
          <p className="text-emerald-800 mt-0.5">
            Please visit your school on{" "}
            <span className="font-semibold">
              {pickupLabel ?? "the scheduled Saturday"}
            </span>{" "}
            to collect the exchange. Carry a photo of this order so the school
            can verify.
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
            Exchange request not approved
            {returnNumber ? ` · ${returnNumber}` : ""}
          </p>
          <p className="text-rose-800 mt-0.5">
            Tap to see why and what to do next.
          </p>
        </div>
      </a>
    );
  }

  if (status === "received") {
    return (
      <a
        href={link}
        className="mt-4 flex items-start gap-3 rounded-2xl border border-ink-200 bg-cream-100 p-4 hover:bg-cream-200/60"
      >
        <Package className="h-5 w-5 text-ink-500 mt-0.5 shrink-0" />
        <div className="text-[13px]">
          <p className="font-display text-[14px] font-bold text-ink-900">
            Exchange completed
            {returnNumber ? ` · ${returnNumber}` : ""}
          </p>
          <p className="text-ink-600 mt-0.5">
            The exchange was handed over at school. Thanks for shopping with
            Inventre.
          </p>
        </div>
      </a>
    );
  }

  return null;
}
