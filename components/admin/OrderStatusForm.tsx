"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilterSelect } from "@/components/admin/ui/primitives";

const STATUSES = [
  ["placed", "Placed"],
  ["confirmed", "Confirmed"],
  ["packed", "Packed"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
  ["returned", "Returned"],
] as const;

/** Order status, changed in place. Saves on pick; reverts if the server refuses. */
export function OrderStatusForm({
  orderId,
  status,
}: {
  orderId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);

  const update = (next: string) => {
    setValue(next);
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? "Update failed");
        setValue(status);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <FilterSelect label="Status" noAll value={value} onChange={(e) => update(e.target.value)} disabled={pending} aria-label="Order status">
        {STATUSES.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </FilterSelect>
      {error ? <span className="text-[12px] font-medium text-red-600">{error}</span> : null}
    </div>
  );
}
