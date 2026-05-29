"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin progress bar pinned to the top of the admin viewport. Visible while:
 *   • a route transition is in-flight (detected via pathname change), or
 *   • any background fetch() is still pending (we wrap window.fetch once).
 *
 * Goal: give the admin instant feedback that *something is happening* on every
 * link click and every API call, so the UI never feels frozen.
 *
 * Implementation notes:
 *   • The fetch wrapper is installed exactly once via a module-level guard
 *     so React StrictMode / hot-reload can't stack interceptors.
 *   • The bar uses an indeterminate animation rather than progress percentages
 *     because most of our requests don't expose progress events.
 *   • A min-visible window (180 ms) prevents flicker on instant API calls.
 */

declare global {
  interface Window {
    __invInflight?: number;
    __invFetchWrapped?: boolean;
    __invSetInflight?: (delta: number) => void;
  }
}

function installFetchWrapper(onChange: (count: number) => void) {
  if (typeof window === "undefined" || window.__invFetchWrapped) {
    // Already wrapped — just subscribe to its updates.
    window.__invSetInflight = (_: number) => onChange(window.__invInflight ?? 0);
    return;
  }
  window.__invFetchWrapped = true;
  window.__invInflight = 0;
  const origFetch = window.fetch.bind(window);

  const bump = (delta: number) => {
    window.__invInflight = Math.max(0, (window.__invInflight ?? 0) + delta);
    onChange(window.__invInflight);
  };
  window.__invSetInflight = bump;

  window.fetch = async (...args: Parameters<typeof fetch>) => {
    bump(1);
    try {
      return await origFetch(...args);
    } finally {
      bump(-1);
    }
  };
}

export function TopProgressBar() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const inflightRef = useRef(0);
  const lastShownAt = useRef(0);

  const apply = (shouldShow: boolean) => {
    if (shouldShow) {
      lastShownAt.current = Date.now();
      setVisible(true);
      return;
    }
    // Keep visible for at least 180 ms so a flash isn't wasted.
    const elapsed = Date.now() - lastShownAt.current;
    const wait = Math.max(0, 180 - elapsed);
    setTimeout(() => {
      if ((inflightRef.current ?? 0) === 0) setVisible(false);
    }, wait);
  };

  // Wire the fetch interceptor on mount.
  useEffect(() => {
    installFetchWrapper((count) => {
      inflightRef.current = count;
      apply(count > 0);
    });
  }, []);

  // Show on every path change — the loading.tsx handles the page-level
  // skeleton, the bar is the headline "something is happening".
  useEffect(() => {
    setVisible(true);
    lastShownAt.current = Date.now();
    const t = setTimeout(() => {
      if ((inflightRef.current ?? 0) === 0) setVisible(false);
    }, 600);
    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <div
      aria-hidden={!visible}
      className={
        "fixed top-0 left-0 right-0 z-[60] h-[2.5px] pointer-events-none transition-opacity duration-200 " +
        (visible ? "opacity-100" : "opacity-0")
      }
    >
      <div className="relative h-full overflow-hidden">
        <div className="absolute inset-0 bg-brand-100/30" />
        <div
          className="absolute inset-y-0 w-1/3 bg-brand-500 shadow-[0_0_10px_rgba(193,87,52,0.65)] animate-[topbarSlide_1.05s_ease-in-out_infinite]"
        />
      </div>
      <style jsx global>{`
        @keyframes topbarSlide {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(180%); }
          100% { transform: translateX(380%); }
        }
      `}</style>
    </div>
  );
}
