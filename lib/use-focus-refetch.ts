"use client";

import { useEffect, useRef } from "react";

/**
 * Refetch data whenever the browser tab regains focus or becomes visible.
 *
 * Used by every customer-facing shop page so admin-panel updates land
 * "instantly" — the moment a parent switches back to the website tab,
 * the page pulls the latest catalog / price / order / shipping data.
 *
 * Pass a stable `refetch` (e.g. via useCallback) or accept that the
 * listener re-attaches on each render; both work but the former avoids
 * a tiny amount of churn.
 *
 * `enabled` lets callers disable while a page is still loading.
 *
 * Internally throttles to one fetch per second so rapidly switching
 * tabs doesn't hammer the API; the ref-based throttle survives the
 * effect re-attaching.
 */
export function useFocusRefetch(
  refetch: () => void | Promise<void>,
  enabled: boolean = true
): void {
  const lastRunAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const tryRun = () => {
      const now = Date.now();
      if (now - lastRunAt.current < 1000) return;
      lastRunAt.current = now;
      void refetch();
    };
    const onFocus = () => tryRun();
    const onVisibility = () => {
      if (document.visibilityState === "visible") tryRun();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refetch, enabled]);
}
