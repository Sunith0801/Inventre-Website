"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Phone, AlertCircle, Check } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { auth, type Me } from "@/lib/auth";

export default function ChangePhonePage() {
  const router = useRouter();
  const [me, setMe] = useState<Extract<Me, { kind: "parent" }> | null>(null);
  const [step, setStep] = useState<"enter" | "verify" | "done">("enter");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    auth.me().then((u) => {
      if (!u || u.kind !== "parent") router.push("/login");
      else setMe(u);
    });
  }, [router]);

  useEffect(() => {
    if (resendIn > 0) {
      const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [resendIn]);

  async function requestOtp() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPhone: phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn’t send OTP. Try again.");
        return;
      }
      setStep("verify");
      setResendIn(30);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPhone: phone, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn’t verify. Try again.");
        return;
      }
      setStep("done");
      // Refresh me so /account shows the new phone
      await auth.me();
      setTimeout(() => router.push("/account"), 1500);
    } finally {
      setBusy(false);
    }
  }

  if (!me) return null;

  return (
    <main className="min-h-screen pb-16">
      <Nav />
      <div className="mx-auto max-w-md px-5 pt-8">
        <Link
          href="/account"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 mb-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to account
        </Link>

        <div className="rounded-2xl border border-ink-100 bg-white overflow-hidden">
          <header className="px-6 py-5 border-b border-ink-100">
            <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-brand">
              Change phone number
            </p>
            <h1 className="mt-1 font-display text-[22px] font-extrabold text-ink-900">
              {step === "done"
                ? "Phone number updated"
                : step === "verify"
                ? "Enter the code we sent"
                : "Enter your new number"}
            </h1>
            <p className="mt-1 text-[13px] text-ink-500">
              Current: +91 {me.phone.slice(0, 5)} {me.phone.slice(5)}
            </p>
          </header>

          <div className="p-6 space-y-4">
            {step === "enter" && (
              <>
                <label className="block">
                  <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500 mb-1.5 inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> New mobile number
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="10-digit phone"
                    className="form-input w-full text-[16px] tracking-wide"
                  />
                </label>
                <button
                  type="button"
                  onClick={requestOtp}
                  disabled={phone.length !== 10 || busy}
                  className="w-full h-12 rounded-full bg-brand text-white font-bold text-[14px] hover:bg-brand-700 transition-colors disabled:opacity-40"
                >
                  {busy ? "Sending…" : "Send OTP to new number"}
                </button>
                <p className="text-[12px] text-ink-500">
                  We’ll text a 6-digit code to confirm you own the new number.
                </p>
              </>
            )}

            {step === "verify" && (
              <>
                <p className="text-[13px] text-ink-700">
                  Code sent to{" "}
                  <span className="font-semibold">+91 {phone.slice(0, 5)} {phone.slice(5)}</span>
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                  className="form-input w-full text-center text-[20px] font-mono tracking-[0.5em]"
                />
                <button
                  type="button"
                  onClick={verifyOtp}
                  disabled={otp.length !== 6 || busy}
                  className="w-full h-12 rounded-full bg-brand text-white font-bold text-[14px] hover:bg-brand-700 transition-colors disabled:opacity-40"
                >
                  {busy ? "Verifying…" : "Verify & update"}
                </button>
                <div className="flex items-center justify-between text-[12px]">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("enter");
                      setOtp("");
                      setError(null);
                    }}
                    className="text-ink-500 hover:text-ink-900"
                  >
                    ← Use a different number
                  </button>
                  <button
                    type="button"
                    onClick={requestOtp}
                    disabled={resendIn > 0 || busy}
                    className="text-brand hover:text-brand-700 font-medium disabled:opacity-50"
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend OTP"}
                  </button>
                </div>
              </>
            )}

            {step === "done" && (
              <div className="text-center py-4">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                  <Check className="h-6 w-6" />
                </div>
                <p className="mt-3 text-[14px] font-semibold text-ink-900">
                  Phone number updated.
                </p>
                <p className="mt-1 text-[12.5px] text-ink-500">
                  Redirecting to your account…
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}
