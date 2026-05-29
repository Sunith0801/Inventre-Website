"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const phone = params.get("phone") ?? "";
  const token = params.get("t") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErr(data?.error ?? "Reset failed.");
      } else {
        setDone(true);
        setTimeout(() => router.push("/login"), 2000);
      }
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <p className="text-sm text-red-600">Missing reset token.</p>;
  }

  if (done) {
    return (
      <p className="text-sm text-green-700">
        Password updated. Redirecting to login…
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {phone ? (
        <p className="text-sm text-neutral-600">For {phone}</p>
      ) : null}
      <div>
        <label htmlFor="pw" className="block text-sm font-medium">
          New password
        </label>
        <input
          id="pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </div>
      <div>
        <label htmlFor="pw2" className="block text-sm font-medium">
          Confirm password
        </label>
        <input
          id="pw2"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </div>
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold mb-6">Reset password</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
