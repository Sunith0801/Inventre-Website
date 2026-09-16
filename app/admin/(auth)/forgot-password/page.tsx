"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, ArrowRight, ArrowLeft, MailCheck } from "lucide-react";

/**
 * Staff "forgot password": ask for the account email, send a reset link.
 * The confirmation reads the same whether or not the address exists — the
 * endpoint never says, so neither does the page.
 */
export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not send the reset link");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center bg-cream px-5">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/INVENTRE_LOGO.png"
            alt="Inventre"
            className="h-9"
          />
          <span className="rounded-full bg-ink-900 text-white px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] uppercase">
            Admin
          </span>
        </div>

        <div className="mt-8 rounded-2xl border border-ink-100 bg-white p-7 shadow-[0_20px_40px_-25px_rgba(0,0,0,0.18)]">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand">
              {sent ? <MailCheck className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            </span>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500">
                Staff sign-in
              </p>
              <h1 className="font-display text-[20px] font-extrabold text-ink-900 leading-tight">
                {sent ? "Check your email" : "Forgot password"}
              </h1>
            </div>
          </div>

          {sent ? (
            <div className="mt-5 space-y-4">
              <p className="text-[13px] text-ink-700 leading-relaxed">
                If <span className="font-semibold">{email}</span> belongs to an active staff account,
                a reset link is on its way. It works for 30 minutes.
              </p>
              <p className="text-[12px] text-ink-500">
                Nothing arrived? Check spam, or ask a Super Admin to reset your password from
                Administration → Users.
              </p>
              <Link
                href="/admin/login"
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-700 hover:text-brand"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-3">
              <p className="text-[13px] text-ink-600">
                Enter your staff email and we&apos;ll send you a link to choose a new password.
              </p>
              <label className="block">
                <span className="text-[12px] font-semibold text-ink-700">Email</span>
                <input
                  type="email"
                  autoFocus
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
                />
              </label>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-ink-900 text-white h-11 px-5 text-[13px] font-bold hover:bg-brand transition-colors disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Send reset link"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>

              <Link
                href="/admin/login"
                className="block text-center text-[12px] text-ink-500 hover:text-ink-900"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
