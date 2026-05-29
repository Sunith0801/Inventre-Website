"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, MessageSquare, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { MobileInput } from "./MobileInput";
import { auth } from "@/lib/auth";

function maskMobile(m: string) {
  if (m.length < 10) return `+91 ${m}`;
  return `+91 ${m.slice(0, 2)}xxx xx${m.slice(8)}`;
}

/**
 * Forgot-password flow — three steps, same shape as FirstTimeModal:
 *   1. mobile  → POST /api/auth/otp/request (sends OTP)
 *   2. OTP     → POST /api/auth/first-time/verify-otp (verifies, does NOT consume)
 *   3. new pwd → POST /api/auth/forgot-password/complete (consumes OTP, sets
 *                password, creates session → /shop)
 */
export function ForgotPasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"mobile" | "otp" | "password">("mobile");
  const [mobile, setMobile] = useState("");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [seconds, setSeconds] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const pwdInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("mobile");
    setMobile("");
    setDigits(["", "", "", "", "", ""]);
    setPwd("");
    setConfirm("");
    setShowPwd(false);
    setSeconds(30);
    setSubmitting(false);
    setDone(false);
    setError(undefined);
  }, [open]);

  // Countdown for the resend-OTP button (only relevant on the OTP step).
  useEffect(() => {
    if (!open || step !== "otp" || seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [open, step, seconds]);

  const onDigit = (i: number, val: string) => {
    const v = val.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
    if (v && i < 5) inputs.current[i + 1]?.focus();
  };
  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0)
      inputs.current[i - 1]?.focus();
  };
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!t) return;
    e.preventDefault();
    const next = ["", "", "", "", "", ""];
    t.split("").forEach((c, i) => (next[i] = c));
    setDigits(next);
    inputs.current[Math.min(t.length, 5)]?.focus();
  };

  // Step 1 → send OTP to the registered mobile.
  const sendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (mobile.length !== 10) return setError("Enter a valid 10-digit mobile number");
    setSubmitting(true);
    setError(undefined);
    try {
      await auth.requestOtp(mobile);
      setSubmitting(false);
      setSeconds(30);
      setStep("otp");
      setTimeout(() => inputs.current[0]?.focus(), 50);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Couldn't send OTP");
    }
  };

  // Step 2 → verify the OTP (no consume).
  const verifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = digits.join("");
    if (code.length < 6) return setError("Enter the complete 6-digit OTP");
    setSubmitting(true);
    setError(undefined);
    try {
      await auth.firstTimeVerifyOtp(mobile, code);
      setSubmitting(false);
      setStep("password");
      setTimeout(() => pwdInput.current?.focus(), 50);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "OTP verification failed");
    }
  };

  // Step 3 → set new password (consumes OTP, creates session).
  const submitPassword = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = digits.join("");
    if (pwd.length < 6) return setError("Password must be at least 6 characters");
    if (pwd !== confirm) return setError("Passwords do not match");
    setSubmitting(true);
    setError(undefined);
    try {
      await auth.forgotPasswordComplete(mobile, code, pwd);
      setSubmitting(false);
      setDone(true);
      // Direct login — go to /shop after a brief success state.
      setTimeout(() => {
        onClose();
        router.push("/shop");
      }, 1200);
    } catch (err) {
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : "Reset failed";
      setError(msg);
      // OTP may have expired between steps — send them back.
      if (/otp/i.test(msg)) setStep("otp");
    }
  };

  const resend = async () => {
    try {
      await auth.requestOtp(mobile);
      setSeconds(30);
      setDigits(["", "", "", "", "", ""]);
      setError(undefined);
      inputs.current[0]?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resend failed");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Reset password" maxWidth="max-w-md">
      <div className="p-6 sm:p-8">
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-6"
            >
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h3 className="mt-4 font-display text-[22px] font-extrabold text-ink-900">
                Password updated
              </h3>
              <p className="mt-1 text-[14px] text-ink-500">
                Signing you in…
              </p>
            </motion.div>
          ) : (
            <motion.form
              key={step}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={
                step === "mobile"
                  ? sendOtp
                  : step === "otp"
                  ? verifyOtp
                  : submitPassword
              }
            >
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand">
                <MessageSquare className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-[24px] font-extrabold text-ink-900 leading-tight">
                {step === "mobile"
                  ? "Reset your password"
                  : step === "otp"
                  ? "Verify your OTP"
                  : "Create a new password"}
              </h3>
              <p className="mt-1 text-[13.5px] text-ink-500">
                {step === "mobile" ? (
                  "Enter your registered mobile number. We'll text you a one-time code."
                ) : step === "otp" ? (
                  <>
                    OTP sent to{" "}
                    <span className="font-semibold text-ink-800">
                      {maskMobile(mobile)}
                    </span>
                  </>
                ) : (
                  <>
                    OTP verified for{" "}
                    <span className="font-semibold text-ink-800">
                      {maskMobile(mobile)}
                    </span>
                    . Set a new password to finish.
                  </>
                )}
              </p>

              {step === "mobile" && (
                <div className="mt-5">
                  <MobileInput
                    id="forgot-mobile"
                    value={mobile}
                    onChange={(v) => {
                      setMobile(v);
                      if (error) setError(undefined);
                    }}
                    error={error}
                    autoFocus
                  />
                </div>
              )}

              {step === "otp" && (
                <>
                  <div className="mt-5 flex gap-2 justify-between">
                    {digits.map((d, i) => (
                      <input
                        key={i}
                        ref={(el) => {
                          inputs.current[i] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={d}
                        onChange={(e) => onDigit(i, e.target.value)}
                        onKeyDown={(e) => onKeyDown(i, e)}
                        onPaste={onPaste}
                        aria-label={`OTP digit ${i + 1}`}
                        className="h-13 w-11 sm:w-12 py-3 rounded-xl border border-ink-200 bg-white text-center font-display text-[20px] font-bold text-ink-900 tabular-nums focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                      />
                    ))}
                  </div>
                  <div className="mt-3 text-[12px] text-ink-500">
                    {seconds > 0 ? (
                      <span>
                        Resend OTP in{" "}
                        <span className="font-semibold tabular-nums text-ink-800">
                          00:{seconds.toString().padStart(2, "0")}
                        </span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={resend}
                        className="font-semibold text-brand hover:text-brand-700 underline underline-offset-4"
                      >
                        Resend OTP
                      </button>
                    )}
                  </div>
                </>
              )}

              {step === "password" && (
                <div className="mt-5 space-y-3">
                  <div
                    className={
                      "flex items-stretch rounded-xl border bg-white overflow-hidden focus-within:border-ink-900 " +
                      (error ? "border-red-300" : "border-ink-200")
                    }
                  >
                    <input
                      ref={pwdInput}
                      type={showPwd ? "text" : "password"}
                      placeholder="New password"
                      autoComplete="new-password"
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      className="flex-1 px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 outline-none bg-transparent"
                    />
                    <button
                      type="button"
                      aria-label={showPwd ? "Hide password" : "Show password"}
                      onClick={() => setShowPwd((s) => !s)}
                      className="px-3 text-ink-500 hover:text-ink-900"
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <input
                    type={showPwd ? "text" : "password"}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={
                      "w-full px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 rounded-xl border bg-white outline-none focus:border-ink-900 " +
                      (error ? "border-red-300" : "border-ink-200")
                    }
                  />
                </div>
              )}

              {error && (
                <p className="mt-3 text-[12px] font-medium text-red-500">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 active:scale-[0.99] transition-all disabled:opacity-60"
              >
                {step === "mobile"
                  ? submitting
                    ? "Sending OTP…"
                    : "Send OTP"
                  : step === "otp"
                  ? submitting
                    ? "Verifying…"
                    : "Verify OTP"
                  : submitting
                  ? "Updating…"
                  : "Reset password"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>

              {step === "password" && (
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setStep("otp");
                  }}
                  className="mt-3 w-full text-[12px] font-semibold text-ink-500 hover:text-ink-900"
                >
                  ← Re-enter OTP
                </button>
              )}
              {step === "otp" && (
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setStep("mobile");
                  }}
                  className="mt-3 w-full text-[12px] font-semibold text-ink-500 hover:text-ink-900"
                >
                  ← Use a different mobile
                </button>
              )}
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
