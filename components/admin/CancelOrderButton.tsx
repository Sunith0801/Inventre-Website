"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

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
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Admin cancelled");
  const [error, setError] = useState<string | null>(null);

  // Cancellation only makes sense before the order ships; later states must
  // go through returns so stock + credit notes stay consistent.
  const cancellable = !["cancelled", "shipped", "delivered", "returned"].includes(status);
  if (!cancellable) return null;

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled", cancellationReason: reason.trim() || "Admin cancelled" }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? `Cancel failed (HTTP ${res.status})`);
          return;
        }
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      }
    });
  };

  return (
    <>
      <Button type="button" variant="secondary" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Cancel order
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        onConfirm={run}
        title={`Cancel order ${orderNumber}?`}
        description="The order stays on record as cancelled, reserved stock is released and the audit ERP is told. It is not deleted."
        confirmLabel="Cancel order"
        busy={pending}
        error={error}
      >
        <Field label="Reason" htmlFor="cancel-reason">
          <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
