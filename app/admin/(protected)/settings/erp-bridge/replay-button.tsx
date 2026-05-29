"use client";

import { useState } from "react";

export function ReplayButton({ deliveryId }: { deliveryId: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/erp-bridge/replay/${deliveryId}`, {
        method: "POST",
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? `Replayed (${j.status ?? "?"})` : `Failed: ${j.error ?? r.status}`);
      if (r.ok) setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="text-[11px] text-ink-700 hover:text-ink-900 underline disabled:opacity-50"
      >
        {busy ? "…" : "Resend"}
      </button>
      {msg ? <span className="text-[11px] text-ink-500">{msg}</span> : null}
    </div>
  );
}
