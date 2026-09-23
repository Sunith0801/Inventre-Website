"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Storefront error boundary (F-15). Until 2026-09-23 an unhandled render error
 * showed Next's default grey page with no way back; this keeps the brand,
 * offers a retry, and leaves the real cause in `storefront_events` via the
 * instrumentation hook (which fires independently of this UI).
 */
export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[root error boundary]", error);
  }, [error]);
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 bg-cream">
      <div className="max-w-md w-full text-center">
        <p className="inline-block rounded-full bg-brand-50 border border-brand-100 text-brand-700 text-xs font-semibold tracking-[0.14em] uppercase px-3 py-1">
          Something went wrong
        </p>
        <h1 className="mt-4 text-2xl font-bold text-ink-900">We could not load this page</h1>
        <p className="mt-2 text-ink-600">
          The problem has been recorded. You can try again, or go back to the store.
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-ink-400">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-xl bg-brand hover:bg-brand-600 text-white font-semibold px-5 py-2.5"
          >
            Try again
          </button>
          <Link
            href="/shop"
            className="rounded-xl border border-ink-200 bg-white text-ink-800 font-semibold px-5 py-2.5"
          >
            Go to the store
          </Link>
        </div>
      </div>
    </main>
  );
}
