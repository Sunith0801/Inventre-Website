"use client";

import { useState } from "react";

export default function FeesLoginForm({
  next,
  staleAdmin = false,
}: {
  next: string;
  staleAdmin?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A fee-desk login is typed on a phone, where autocapitalise and a stray
  // space are invisible behind the dots. The reveal lets them see what they
  // actually typed instead of guessing at a 401.
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/fees/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Sign-in failed");
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div className="fx fx-login">
      <form className="fx-login-card" onSubmit={submit}>
        <div className="fx-rule-eyebrow">
          <span className="kicker">MyClassBoard · Fee ledger</span>
        </div>
        <h1 className="fx-title">
          Fee ledger.<br />
          <em>Sign in.</em>
        </h1>
        <p className="fx-sub">
          This sign-in is for the fee ledger only. Inventre admin accounts sign in at
          /admin — the two are separate, and one browser can hold both.
        </p>

        <label>
          <span className="kicker">Email</span>
          <input
            className="fx-input mono"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          <span className="kicker">Password</span>
          <span className="fx-pw">
            <input
              className="fx-input mono"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="fx-pw-eye"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              aria-pressed={showPw}
              title={showPw ? "Hide password" : "Show password"}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path
                  d="M1.7 12S5.5 5.5 12 5.5 22.3 12 22.3 12 18.5 18.5 12 18.5 1.7 12 1.7 12Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
                {showPw ? <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.4" /> : null}
              </svg>
            </button>
          </span>
        </label>

        {staleAdmin ? (
          <div className="fu-msg">
            You were signed in on an old admin session for a fee-desk account.
            That session has been cleared. Sign in below for the fee ledger, or
            go to <a href="/admin/login">/admin/login</a> to use an Inventre
            admin account.
          </div>
        ) : null}

        {error ? <div className="fu-msg is-bad">{error}</div> : null}

        <button className="fx-page fu-submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
