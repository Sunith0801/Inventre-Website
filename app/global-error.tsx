"use client";

/**
 * Last-resort boundary: catches errors thrown by the ROOT layout itself,
 * which `app/error.tsx` cannot — at that point React has no layout left to
 * render into, so this file must supply its own <html>/<body>.
 *
 * Deliberately dependency-free and inline-styled: whatever broke may well be
 * the font loader, the global stylesheet or a provider in the root layout,
 * so this screen must not rely on any of them.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#FAF7F2",
          color: "#0A0A0A",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "440px" }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: "#E47127",
              margin: "0 auto 20px",
            }}
          />
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
            Inventre is temporarily unavailable
          </h1>
          <p style={{ marginTop: 12, fontSize: 15, lineHeight: 1.6, color: "#5C5950" }}>
            We hit an unexpected error while loading the site. Please try again in a moment.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              height: 48,
              padding: "0 28px",
              borderRadius: 999,
              border: "none",
              background: "#E47127",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: 28, fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#8A8678" }}>
              Reference {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
