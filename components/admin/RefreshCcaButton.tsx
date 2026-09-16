"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

/**
 * Renders in the order's Payment card. Click → POST
 * /api/admin/orders/[id]/refresh-cca, which calls CCAvenue's Status API and
 * merges the fresh values into the local `payments` row, then
 * `router.refresh()` so the card updates. The result shows inline for a few
 * seconds, then clears.
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
        const r = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/refresh-cca`, { method: "POST" });
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
            msg: `CCAvenue says ${data.rawStatus ?? data.status ?? "ok"}${data.trackingId ? ` · ${data.trackingId}` : ""}`,
          });
          startTransition(() => router.refresh());
        }
      } catch (e) {
        setFeedback({ ok: false, msg: e instanceof Error ? e.message : "Network error" });
      } finally {
        setBusy(false);
        setTimeout(() => setFeedback(null), 6000);
      }
    })();
  }

  return (
    <div className="inline-flex items-center gap-2">
      {feedback ? (
        <span className={"inline-flex items-center gap-1 text-[12px] " + (feedback.ok ? "text-emerald-700" : "text-red-700")}>
          {feedback.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {feedback.msg}
        </span>
      ) : null}
      <Button variant="secondary" size="sm" busy={busy} onClick={refresh} icon={<RefreshCw className="h-3.5 w-3.5" />} title="Ask CCAvenue for the latest status of this payment">
        Refresh from CCAvenue
      </Button>
    </div>
  );
}
