"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, ShieldCheck, Trash2, Check } from "lucide-react";

/**
 * "Your data" card on /account — DPDP right of access + right of erasure.
 * Download is a plain anchor to the export route (the browser saves the
 * attachment); deletion opens an inline confirm and POSTs a concern.
 */

type Outcome =
  | { kind: "created"; concernNumber: string | null }
  | { kind: "existing"; concernNumber: string | null };

export function YourDataCard() {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/me/erasure-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        existing?: boolean;
        concernNumber?: string | null;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      setOutcome({
        kind: data.existing ? "existing" : "created",
        concernNumber: data.concernNumber ?? null,
      });
      setConfirming(false);
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white p-6 mt-6 border border-ink-100 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.10)]">
      <header className="mb-4">
        <h2 className="font-display text-[16px] font-bold text-ink-900 inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-brand" />
          Your data
        </h2>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          Your rights over the information we hold.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Download */}
        <div className="rounded-2xl border border-ink-100 bg-cream-50 p-4 flex flex-col gap-3">
          <p className="text-[13px] text-ink-700 leading-relaxed">
            Download a copy of everything Inventre holds about you and your
            children.
          </p>
          <a
            href="/api/auth/me/export"
            download
            className="mt-auto inline-flex items-center justify-center gap-2 rounded-full border border-ink-200 bg-white px-4 py-2 text-[13px] font-semibold text-ink-800 hover:border-brand hover:text-brand transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download my data
          </a>
        </div>

        {/* Deletion */}
        <div className="rounded-2xl border border-ink-100 bg-cream-50 p-4 flex flex-col gap-3">
          <p className="text-[13px] text-ink-700 leading-relaxed">
            Ask us to delete your account. Orders and invoices are kept for tax
            law; your identifiers are removed.
          </p>

          {outcome ? (
            <div className="mt-auto rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[12.5px] text-emerald-900">
              <p className="font-semibold inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" />
                {outcome.kind === "existing"
                  ? "You already have an open deletion request"
                  : "Deletion request received"}
              </p>
              {outcome.concernNumber && (
                <p className="mt-1">
                  Reference{" "}
                  <span className="font-mono font-semibold">{outcome.concernNumber}</span>
                </p>
              )}
              <p className="mt-1">
                Our grievance officer will respond within 7 working days.
              </p>
            </div>
          ) : confirming ? (
            <div className="mt-auto flex flex-col gap-2.5">
              <label className="text-[11px] font-bold tracking-[0.14em] uppercase text-ink-500">
                Reason (optional)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 500))}
                  rows={3}
                  maxLength={500}
                  placeholder="Tell us why, if you'd like"
                  className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-[13px] font-normal normal-case tracking-normal text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                />
              </label>
              {error && (
                <p className="text-[12.5px] font-medium text-red-700">{error}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {submitting ? "Sending…" : "Confirm deletion request"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                  disabled={submitting}
                  className="text-[13px] font-semibold text-ink-600 hover:text-ink-900 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-auto inline-flex items-center justify-center gap-2 rounded-full border border-red-200 bg-white px-4 py-2 text-[13px] font-semibold text-red-700 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Request account deletion
            </button>
          )}
        </div>
      </div>

      <p className="mt-4 text-[12px] text-ink-500">
        Read our{" "}
        <Link href="/privacy" className="font-semibold text-ink-700 underline underline-offset-2 hover:text-brand">
          privacy notice
        </Link>{" "}
        for what we collect and why.
      </p>
    </section>
  );
}
