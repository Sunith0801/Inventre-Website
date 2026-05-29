"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const STATUSES = [
  "placed",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;

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
        setError("Update failed");
        setValue(status);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-3">
      <label className="text-[12px] font-semibold text-ink-700">
        Status
        <select
          value={value}
          onChange={(e) => update(e.target.value)}
          disabled={pending}
          className="ml-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-800 outline-none focus:border-ink-900"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {error && <span className="text-[12px] text-red-600">{error}</span>}
    </div>
  );
}
