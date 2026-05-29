"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * Hard-deletes an order via DELETE /api/admin/orders/{id}. Confirms
 * inline so an accidental click can't drop data, then redirects back
 * to the listing on success. Mirrors the UX of `DeleteRuleButton` in
 * the delivery-fee-rules admin so the affordances feel familiar.
 */
export function DeleteOrderButton({
  orderId,
  orderNumber,
  /** When true, renders a small icon-only chip (for inline-row use on
   *  /admin/orders). Otherwise renders a full labelled button (for the
   *  /admin/orders/[id] detail page). */
  compact = false,
  /** Where to navigate after a successful delete. Detail page goes to
   *  `/admin/orders`; row-level delete can stay put (refresh). */
  redirectTo = "/admin/orders",
}: {
  orderId: string;
  orderNumber: string;
  compact?: boolean;
  redirectTo?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (
      !window.confirm(
        `Delete order ${orderNumber}? This removes the order and all related rows (items, payments, shipments, invoices, returns) locally. ERPNext is NOT touched. This cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/orders/${orderId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          setError(body?.error ?? `Delete failed (HTTP ${res.status})`);
          return;
        }
        if (redirectTo) {
          router.push(redirectTo);
          router.refresh();
        } else {
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      }
    });
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          run();
        }}
        disabled={pending}
        title={error ?? `Delete ${orderNumber}`}
        className={
          "inline-flex h-7 w-7 items-center justify-center rounded-md border text-rose-600 transition " +
          (pending
            ? "opacity-50 border-ink-200"
            : "border-rose-200 hover:border-rose-500 hover:bg-rose-50")
        }
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={
          "inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] font-semibold transition " +
          (pending
            ? "border-ink-200 text-ink-400"
            : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50")
        }
      >
        <Trash2 className="h-3.5 w-3.5" />
        {pending ? "Deleting…" : "Delete order"}
      </button>
      {error && (
        <p className="text-[11px] text-rose-700 leading-snug">{error}</p>
      )}
    </div>
  );
}
