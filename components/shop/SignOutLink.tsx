"use client";

import { useState } from "react";

/**
 * Minimal sign-out control for pages that render outside the shop nav
 * (currently the storefront-closed screen). /api/auth/logout is POST-only
 * and answers with JSON, so it has to be fetched rather than linked, and
 * the redirect is a hard navigation to drop any cached RSC payload that
 * still holds the old session.
 */
export default function SignOutLink({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          // Cookie clearing is server-side; on a network blip just bounce
          // them to /login rather than stranding them on a dead screen.
        }
        window.location.href = "/login";
      }}
      className={className}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
