"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";

/**
 * Cancels an order via PATCH /api/admin/orders/{id} { status: "cancelled" }.
 * Unlike Delete (which hard-removes all local rows), Cancel keeps the order
 * as a `cancelled` record, releases any reserved stock, and notifies audit
 * with `order.cancelled` (audit marks the SO cancelled — it is NOT removed
 * from audit /orders). Shipped/delivered orders are rejected server-side
 * (use the returns flow); we hide the button for those + already-cancelled.
 */
export function CancelOrderButton({
  orderId,
  orderNumber,
  status,
}: {
  orderId: string;
  orderNumber: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Cancellation only makes sense before the order ships; later states must
  // go through returns so stock + credit notes stay consistent.
  const cancellable = !["cancelled", "shipped", "delivered", "returned"].includes(
    status
  );
  if (!cancellable) return null;

  const run = () => {
    if (
      !window.confirm(
        `Cancel order ${orderNumber}? This marks it cancelled, releases reserved stock, and notifies audit (the order stays as a cancelled record — it is not deleted).`
      )
    ) {
      return;
    }
    const reason =
      window.prompt("Cancellation reason (optional):", "Admin cancelled") ??
      "Admin cancelled";
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "cancelled",
            cancellationReason: reason,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          setError(body?.error ?? `Cancel failed (HTTP ${res.status})`);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      }
    });
  };

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
            : "border-amber-300 bg-white text-amber-700 hover:bg-amber-50")
        }
      >
        <Ban className="h-3.5 w-3.5" />
        {pending ? "Cancelling…" : "Cancel order"}
      </button>
      {error && (
        <p className="text-[11px] text-rose-700 leading-snug">{error}</p>
      )}
    </div>
  );
}
