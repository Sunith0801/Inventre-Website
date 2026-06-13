"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";

/** Re-fires one failed order-confirmation notification, then refreshes
 *  the server-rendered log table so the new attempt row appears. */
export function NotificationResendButton({ logId }: { logId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/notifications/${logId}/resend`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1 text-[12px] font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RotateCw className="h-3 w-3" />
        )}
        Resend
      </button>
      {error && (
        <span className="text-[11px] text-red-600" title={error}>
          {error.slice(0, 40)}
        </span>
      )}
    </span>
  );
}
