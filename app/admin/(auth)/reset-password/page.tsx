"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, ArrowRight, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

const MIN_PASSWORD = 8;

/**
 * Staff "forgot password", step 2: the page the emailed link opens. Takes the
 * single-use token from the URL, asks for the new password twice, and sends
 * the user back to sign in with it.
 */
function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("t") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not reset the password");
      }
      setDone(true);
      setTimeout(() => router.push("/admin/login"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password");
    } finally {
      setSubmitting(false);
    }
  };

  const field =
    "flex-1 px-3 py-2.5 text-[14px] outline-none bg-transparent";

  return (
    <div className="mt-8 rounded-2xl border border-ink-100 bg-white p-7 shadow-[0_20px_40px_-25px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-brand">
          {done ? <CheckCircle2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </span>
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500">
            Staff sign-in
          </p>
          <h1 className="font-display text-[20px] font-extrabold text-ink-900 leading-tight">
            {done ? "Password updated" : "Choose a new password"}
          </h1>
        </div>
      </div>

      {done ? (
        <div className="mt-5 space-y-4">
          <p className="text-[13px] text-ink-700">
            Your password has been changed. Taking you to sign in…
          </p>
          <Link href="/admin/login" className="text-[13px] font-semibold text-ink-700 hover:text-brand">
            Sign in now
          </Link>
        </div>
      ) : !token ? (
        <div className="mt-5 space-y-4">
          <p className="text-[13px] text-ink-700">
            This link is missing its reset code. Open the link from the email again, or request a new
            one.
          </p>
          <Link href="/admin/forgot-password" className="text-[13px] font-semibold text-ink-700 hover:text-brand">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block">
            <span className="text-[12px] font-semibold text-ink-700">New password</span>
            <div className="mt-1 flex rounded-xl border border-ink-200 bg-white overflow-hidden focus-within:border-ink-900">
              <input
                type={show ? "text" : "password"}
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="px-3 text-ink-500 hover:text-ink-900"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <span className="mt-1 block text-[11.5px] text-ink-500">At least {MIN_PASSWORD} characters.</span>
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold text-ink-700">Confirm new password</span>
            <div className="mt-1 flex rounded-xl border border-ink-200 bg-white overflow-hidden focus-within:border-ink-900">
              <input
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={field}
              />
            </div>
          </label>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {error}
              {/expired|invalid/i.test(error) ? (
                <>
                  {" "}
                  <Link href="/admin/forgot-password" className="font-semibold underline">
                    Request a new link
                  </Link>
                </>
              ) : null}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-ink-900 text-white h-11 px-5 text-[13px] font-bold hover:bg-brand transition-colors disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Set new password"}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>
      )}
    </div>
  );
}

export default function AdminResetPasswordPage() {
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
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}
