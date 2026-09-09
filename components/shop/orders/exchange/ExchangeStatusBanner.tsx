"use client";

/**
 * Status banner shown at the top of an order-detail page when there is
 * an exchange request open against this order. Renders nothing if no
 * active exchange. Visible only to allowlisted parents — the gate is
 * upstream (the API only returns `activeExchange` for testers).
 */

import { CheckCircle2, AlertCircle, Clock, Package } from "lucide-react";
import { resolveDuplicateOf } from "@/lib/return-duplicates";
import { DuplicateOfNote } from "@/components/shop/orders/DuplicateOfNote";

type ActiveExchange = {
  id: string;
  returnNumber: string | null;
  status: string;
  pickupDate: string | null;
  createdAt: string;
  // True when the order's school collects exchanges at the Inventre store,
  // not the school office (KLINK / QLPHP) — swaps the banner wording.
  atStore?: boolean;
  // Present on rejected requests: the free-text reason and the structured
  // list of other RTN(s) this one duplicates. Drive the "another request
  // already exists" callout on the rejected banner.
  rejectionReason?: string | null;
  duplicateOf?: unknown;
};

export function ExchangeStatusBanner({
  orderId,
  activeExchange,
}: {
  orderId: string;
  activeExchange: ActiveExchange | null;
}) {
  if (!activeExchange) return null;

  const { id, returnNumber, status, atStore } = activeExchange;

  const link = `/shop/orders/${orderId}/exchange/${id}`;

  // Bold store-name fragments for the KLINK/QLPHP (atStore) copy.
  const storeName = (
    <span className="font-semibold">Inventre Experience Store, Ashoka Mall, Kukatpally</span>
  );
  const storeTeam = (
    <span className="font-semibold">Inventre Experience Store team</span>
  );

  const dups =
    status === "rejected"
      ? resolveDuplicateOf(
          activeExchange.duplicateOf,
          activeExchange.rejectionReason,
          returnNumber
        )
      : [];

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
            Your exchange is on its way to{" "}
            {atStore ? <>the {storeName}</> : "your school"}.{" "}
            {atStore ? <>The {storeTeam} will</> : "The school will"} inform you
            once it has been received, and you can collect it then.
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
          <DuplicateOfNote dups={dups} />
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
            The exchange was handed over at {atStore ? <>the {storeName}</> : "school"}.
            Thanks for shopping with Inventre.
          </p>
        </div>
      </a>
    );
  }

  return null;
}
