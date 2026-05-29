"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";

/**
 * Renders next to the CCAvenue tracking ID in the order detail page's
 * Payment Details card. Click → POST /api/admin/orders/[id]/refresh-cca,
 * which calls CCAvenue's Status API and merges the fresh values into
 * the local `payments` row, then `router.refresh()` so the cards update.
 *
 * Inline result indicator: green check + "ok · <status>" or red warning
 * + the error message. Auto-clears after 6 s so the chip stays clean.
 */
export function RefreshCcaButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  function refresh() {
    setBusy(true);
    setFeedback(null);
    void (async () => {
      try {
        const r = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/refresh-cca`, {
          method: "POST",
        });
        const data = (await r.json().catch(() => null)) as {
          ok?: boolean;
          status?: string;
          rawStatus?: string;
          trackingId?: string | null;
          error?: string;
        } | null;
        if (!r.ok || !data?.ok) {
          setFeedback({ ok: false, msg: data?.error ?? `Refresh failed (HTTP ${r.status})` });
        } else {
          setFeedback({
            ok: true,
            msg: `CCAvenue: ${data.rawStatus ?? data.status ?? "ok"}${data.trackingId ? ` · ${data.trackingId}` : ""}`,
          });
          startTransition(() => router.refresh());
        }
      } catch (e) {
        setFeedback({ ok: false, msg: e instanceof Error ? e.message : "Network error" });
      } finally {
        setBusy(false);
        // Auto-clear the indicator after a few seconds so the chip
        // stops competing with the rest of the panel.
        setTimeout(() => setFeedback(null), 6000);
      }
    })();
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className={
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold " +
          (busy
            ? "border-ink-200 text-ink-400 cursor-wait"
            : "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100")
        }
        title="Hit CCAvenue's Status API and merge fresh values into this payment row"
      >
        <RefreshCw className={"h-3 w-3 " + (busy ? "animate-spin" : "")} />
        {busy ? "Refreshing…" : "Refresh from CCAvenue"}
      </button>
      {feedback ? (
        <span
          className={
            "inline-flex items-center gap-1 text-[11.5px] " +
            (feedback.ok ? "text-emerald-700" : "text-red-700")
          }
        >
          {feedback.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {feedback.msg}
        </span>
      ) : null}
    </div>
  );
}
