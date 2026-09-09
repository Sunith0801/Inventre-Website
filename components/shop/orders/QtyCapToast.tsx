"use client";

/**
 * Tiny self-contained toast used by the exchange / missing pickers to
 * explain a quantity clamp ("Only 1 of \"SMS Caps\" was ordered."). The
 * project has no toast library, and a full one isn't worth pulling in for
 * one message — this is a fixed-position card that auto-dismisses.
 *
 * Usage:
 *   const { toast, showQtyCapToast } = useQtyCapToast();
 *   …
 *   {toast}
 */

import { useCallback, useEffect, useRef, useState } from "react";

const DISMISS_MS = 4000;

export function useQtyCapToast(): {
  toast: React.ReactNode;
  showQtyCapToast: (message: string) => void;
} {
  const [message, setMessage] = useState<string | null>(null);
  // Bumped on every call so re-showing the SAME message restarts the timer
  // (a customer who types 5, then 9, should see the toast twice).
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showQtyCapToast = useCallback((msg: string) => {
    setMessage(msg);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!message) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), DISMISS_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, nonce]);

  const toast = message ? (
    <div
      // aria-live so a screen reader announces the clamp too — the visual
      // jump-back is invisible to anyone not watching the box.
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[22rem] rounded-xl border border-amber-200 bg-white shadow-lg px-4 py-3 flex items-start gap-2.5"
    >
      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
      <p className="text-[13px] text-ink-700 leading-snug">{message}</p>
    </div>
  ) : null;

  return { toast, showQtyCapToast };
}
