"use client";

import { useEffect, useState } from "react";

/**
 * Client half of the support-view banner: renders the read-only bar, a live
 * mm:ss countdown to token expiry, and force-navigates to the "session ended"
 * page the moment the clock hits zero (the cookie/JWT expire at the same time,
 * so the agent would otherwise get silently bounced to /login on the next click).
 */
export function SupportViewBannerClient({
  agentLabel,
  parentName,
  parentPhone,
  expMs,
}: {
  agentLabel: string;
  parentName: string;
  parentPhone: string;
  expMs: number;
}) {
  // null until mounted so server and client render the same markup (no hydration
  // mismatch from Date.now() differing between the two).
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    let done = false;
    const tick = () => {
      const left = expMs - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !done) {
        done = true;
        window.location.replace("/support-view/ended");
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expMs]);

  const countdown =
    remainingMs === null
      ? "--:--"
      : (() => {
          const s = Math.max(0, Math.floor(remainingMs / 1000));
          const m = Math.floor(s / 60);
          return `${m}:${String(s % 60).padStart(2, "0")}`;
        })();
  const expiring = remainingMs !== null && remainingMs <= 60_000;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        background: "#dc2626",
        color: "white",
        padding: "8px 12px",
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        display: "flex",
        gap: 16,
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        borderBottom: "2px solid #991b1b",
      }}
      role="alert"
    >
      <span>
        🔒 <b>Agent {agentLabel}</b> · <b>READ-ONLY</b> &nbsp;— viewing{" "}
        <b>{parentName}</b>&rsquo;s account{" "}
        <span style={{ opacity: 0.85 }}>({parentPhone})</span>
      </span>
      <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 6,
            background: expiring ? "#ffffff" : "rgba(255,255,255,0.18)",
            color: expiring ? "#991b1b" : "white",
          }}
          aria-live="polite"
          title="Read-only session expires"
        >
          ⏱ ends in {countdown}
        </span>
        {/* Plain link, not a fetch: the cookie is httpOnly and persistent, so
            only a top-level navigation to the exit route can clear it. */}
        <a
          href="/support-view/exit"
          style={{
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: 6,
            background: "#ffffff",
            color: "#991b1b",
            textDecoration: "none",
            whiteSpace: "nowrap",
            border: "1px solid rgba(255,255,255,.85)",
          }}
          title="Clear the read-only cookie and return to your own session"
        >
          ✕ Exit view
        </a>
      </span>
    </div>
  );
}
