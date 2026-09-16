"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, ArrowRight, Eye, EyeOff } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Login failed");
      }
      // Land via /admin so the server routes restricted roles (who may lack
      // dashboard access) to their first permitted page instead of the
      // dashboard, which would bounce them back in a redirect loop.
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
              <Lock className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500">
                Staff sign-in
              </p>
              <h1 className="font-display text-[20px] font-extrabold text-ink-900 leading-tight">
                Inventre admin
              </h1>
            </div>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-700">Email</span>
              <input
                type="email"
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
              />
            </label>
            <label className="block">
              <span className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-ink-700">Password</span>
                <Link href="/admin/forgot-password" className="text-[11.5px] font-medium text-ink-500 hover:text-brand">
                  Forgot password?
                </Link>
              </span>
              <div className="mt-1 flex rounded-xl border border-ink-200 bg-white overflow-hidden focus-within:border-ink-900">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 px-3 py-2.5 text-[14px] outline-none bg-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="px-3 text-ink-500 hover:text-ink-900"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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
              {submitting ? "Signing in…" : "Sign in"}
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-ink-400">
          Parents → <a href="/login" className="text-ink-700 hover:text-brand">parent sign-in</a>
        </p>
      </div>
    </main>
  );
}
