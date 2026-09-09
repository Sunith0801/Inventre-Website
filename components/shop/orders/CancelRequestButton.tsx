"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, XCircle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

/**
 * Customer-facing "Cancel request" control for an exchange / missing-item
 * request status page. Rendered ONLY when the request is still early enough
 * to cancel (the server page decides that; see `isCancellableRequestStatus`).
 *
 * Clicking opens a confirm dialog that explains the consequence and requires
 * a reason (1–500 chars). On confirm it POSTs to the backend cancel endpoint
 * — which signs + forwards the event to the ERP (the secret never touches the
 * browser). Once cancelled (or a cancel is in flight) the button is hidden so
 * the customer can't double-submit.
 */

const MAX_REASON = 500;

export function CancelRequestButton({
  kind,
  orderId,
  requestId,
  label = "Cancel request",
}: {
  kind: "exchange" | "missing";
  orderId: string;
  requestId: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= 1 && trimmed.length <= MAX_REASON;
  const canConfirm = reasonValid && !submitting;

  // Once done (cancel accepted) the button disappears entirely — the page
  // refresh re-renders the "Cancelled" state; this just avoids any flicker.
  if (done) return null;

  const submit = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/shop/orders/${orderId}/${kind}/${requestId}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmed }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
        refresh?: boolean;
      };

      if (res.ok && data.status === "cancelled") {
        // Optimistic success — the ERP accepted; the confirming webhook will
        // land shortly. Reflect it immediately.
        setDone(true);
        setOpen(false);
        router.refresh();
        return;
      }

      // 409 → the window closed (already packed / dispatched) or a stale seq.
      // Never blind-retry; surface the message and pull fresh status.
      setError(
        data.error ??
          "This request can no longer be cancelled. Please refresh and check its status.",
      );
      setSubmitting(false);
      if (data.refresh || res.status === 409) router.refresh();
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-[13px] font-medium text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-50"
      >
        <XCircle className="h-4 w-4" />
        {label}
      </button>

      <Modal
        open={open}
        onClose={() => {
          if (!submitting) setOpen(false);
        }}
        title="Cancel this request?"
      >
        <div className="p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <p className="text-[13.5px] leading-relaxed text-ink-700">
              This cancels your request and the replacement{" "}
              <span className="font-semibold">will not be sent</span>. This
              can&apos;t be undone. If the warehouse has already packed or
              dispatched it, we may not be able to cancel in time.
            </p>
          </div>

          <label className="mt-5 block text-[12px] font-semibold uppercase tracking-wider text-ink-600">
            Reason for cancelling <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_REASON}
            rows={3}
            disabled={submitting}
            placeholder="Tell us briefly why you're cancelling…"
            className="mt-1.5 w-full resize-none rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13.5px] text-ink-900 outline-none focus:border-rose-400 disabled:opacity-60"
          />
          <div className="mt-1 flex justify-between text-[11px] text-ink-400">
            <span>{trimmed.length < 1 ? "A reason is required." : ""}</span>
            <span>
              {reason.length}/{MAX_REASON}
            </span>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12.5px] text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="mt-6 flex gap-2.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="flex-1 rounded-xl border border-ink-200 bg-white py-2.5 text-[13.5px] font-semibold text-ink-700 hover:bg-cream-50 disabled:opacity-60"
            >
              Keep request
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canConfirm}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-2.5 text-[13.5px] font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Cancelling…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Confirm cancellation
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
