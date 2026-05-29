"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function SendNowButton({
  queueId,
  variant,
}: {
  queueId: string;
  variant: "send" | "retry";
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const label = variant === "retry" ? "Retry" : "Send now";
  const cls =
    variant === "retry"
      ? "px-2 py-1 text-[11px] rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800"
      : "px-2 py-1 text-[11px] rounded border border-ink-200 bg-white hover:bg-ink-50 text-ink-800";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={cls}
        onClick={() => {
          setErr(null);
          start(async () => {
            const url = `/api/admin/erp-bridge/send-now/${queueId}${variant === "retry" ? "?retry=1" : ""}`;
            const r = await fetch(url, { method: "PATCH" });
            if (!r.ok) {
              setErr(`HTTP ${r.status}`);
              return;
            }
            router.refresh();
          });
        }}
      >
        {busy ? "…" : label}
      </button>
      {err ? <span className="text-[11px] text-rose-600">{err}</span> : null}
    </span>
  );
}
