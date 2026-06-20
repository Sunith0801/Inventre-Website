"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Silently re-runs the server component (re-fetches data, no full page
 * reload, scroll position preserved) on a fixed interval. Used on the
 * order-notifications dashboard so new sends appear without a manual reload.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
