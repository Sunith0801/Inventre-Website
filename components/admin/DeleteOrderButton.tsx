"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

/**
 * Hard-deletes an order via DELETE /api/admin/orders/{id}. Asks first —
 * an accidental click must not drop data — then goes back to the listing.
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
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/orders/${orderId}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? `Delete failed (HTTP ${res.status})`);
          return;
        }
        setOpen(false);
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

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          disabled={pending}
          title={`Delete ${orderNumber}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-300 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button type="button" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
          Delete order
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        onConfirm={run}
        title={`Delete order ${orderNumber}?`}
        description="Removes the order and everything attached to it here — items, payments, shipments, invoices, returns. ERPNext is not touched. This cannot be undone."
        confirmLabel="Delete order"
        busy={pending}
        error={error}
      />
    </>
  );
}
