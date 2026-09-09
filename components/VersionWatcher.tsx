"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reloads a tab when a new build is deployed.
 *
 * A deploy swaps the container, but an open tab keeps running the JS it
 * already downloaded — so a change is live on the server and invisible on
 * screen until someone reloads. The HTML is not the problem (admin pages are
 * dynamic and served no-store); the loaded bundle is. So the page has to
 * notice for itself, by polling the build fingerprint at /api/version.
 *
 * `careful` is the difference between a dashboard and the admin. On a
 * read-only dashboard, reloading is free. In /admin someone may be halfway
 * through an order edit, and a reload would silently discard it — so there,
 * ANY input/change event on the page marks it dirty for the rest of its life
 * and the reload becomes a prompt instead. A page nobody has typed into still
 * reloads on its own, which is the common case.
 */
const POLL_MS = 60_000;

export default function VersionWatcher({
  careful = false,
  className,
}: {
  /** Never auto-reload once the user has edited anything on the page. */
  careful?: boolean;
  /** Styling hook for the prompt; falls back to self-contained styles. */
  className?: string;
}) {
  const [stale, setStale] = useState(false);
  const known = useRef<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!careful) return;
    const markDirty = () => {
      dirty.current = true;
    };
    // Capture phase: catches events inside components that stop propagation.
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
    };
  }, [careful]);

  useEffect(() => {
    let dead = false;

    const check = async () => {
      if (dead || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { buildId } = await r.json();
        if (!buildId || dead) return;
        if (known.current === null) {
          known.current = buildId;
          return;
        }
        if (buildId === known.current) return;

        const el = document.activeElement;
        const typing =
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement;
        if (typing || (careful && dirty.current)) setStale(true);
        else window.location.reload();
      } catch {
        // Offline, or mid-deploy while the container restarts. Silence is
        // correct — the next tick picks it up.
      }
    };

    const timer = setInterval(check, POLL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    void check();

    return () => {
      dead = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [careful]);

  if (!stale) return null;
  if (className) {
    return (
      <div className={className}>
        <span>A newer version of this page is available.</span>
        <button onClick={() => window.location.reload()}>Refresh now</button>
      </div>
    );
  }
  // Self-contained so it can be dropped into any layout without importing a
  // stylesheet — /admin is Tailwind, /fees is its own scoped CSS.
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 22,
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 14px",
        background: "#16150f",
        color: "#f7f3ec",
        fontSize: 13,
        borderRadius: 8,
        boxShadow: "0 6px 20px rgba(22,21,15,0.28)",
      }}
    >
      <span>
        A newer version is available
        {". "}
        <span style={{ opacity: 0.7 }}>Unsaved changes will be lost.</span>
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: "#e47127",
          color: "#fff",
          border: 0,
          borderRadius: 6,
          padding: "7px 12px",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Refresh
      </button>
    </div>
  );
}
