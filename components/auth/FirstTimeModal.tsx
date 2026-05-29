"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { auth } from "@/lib/auth";
import { TC_SECTIONS, TC_REQUIRED_CHECKS, TC_VERSION } from "@/lib/legal/terms";

function maskMobile(m: string) {
  if (m.length < 10) return `+91 ${m}`;
  return `+91 ${m.slice(0, 2)}xxx xx${m.slice(8)}`;
}

/**
 * First-time setup: verify the OTP sent to the registered number, then
 * set a password. After completion the parent signs in normally.
 */
export function FirstTimeModal({
  open,
  mobile,
  onClose,
  onComplete,
}: {
  open: boolean;
  mobile: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<"otp" | "password" | "terms">("otp");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [seconds, setSeconds] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  // Track which of the TC_REQUIRED_CHECKS have been ticked. The Continue
  // button on the terms step stays disabled until every one of them is true.
  const [acceptedChecks, setAcceptedChecks] = useState<Record<string, boolean>>({});
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const pwdInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("otp");
    setDigits(["", "", "", "", "", ""]);
    setPwd("");
    setConfirm("");
    setShowPwd(false);
    setSeconds(30);
    setSubmitting(false);
    setDone(false);
    setError(undefined);
    setAcceptedChecks({});
    setTimeout(() => inputs.current[0]?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open || seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [open, seconds]);

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

  // Step 1 → verify the OTP server-side (without consuming it), then
  // reveal the create-password / confirm-password fields.
  const verifyOtpStep = async (e?: React.FormEvent) => {
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

  // Step 2 → validate the password locally (we do NOT submit yet — the
  // T&C acceptance step is the atomic submit point, so the OTP isn't
  // consumed until the user has accepted the policy).
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (pwd.length < 6)
      return setError("Password must be at least 6 characters");
    if (pwd !== confirm) return setError("Passwords do not match");
    setError(undefined);
    setStep("terms");
  };

  // Step 3 → user has ticked every required acceptance checkbox. Submit
  // password + tcAcceptedVersion to the server; on success the parent's
  // session is created and we show the success card.
  const acceptAndComplete = async () => {
    const code = digits.join("");
    if (!allChecksTicked) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await auth.firstTimeComplete(mobile, code, pwd, TC_VERSION);
      setSubmitting(false);
      setDone(true);
    } catch (err) {
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : "Setup failed";
      setError(msg);
      // OTP may have expired between steps — bounce them back so they can
      // request a fresh one. The password and acceptance state are kept.
      if (err instanceof Error && /otp/i.test(err.message)) setStep("otp");
    }
  };

  // All required checkboxes ticked? Drives the Continue button state.
  const allChecksTicked = TC_REQUIRED_CHECKS.every(
    (c) => acceptedChecks[c.id] === true
  );

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

  // The terms step is non-dismissible — we can't half-create a session
  // mid-acceptance, so closing the modal there must do nothing. All other
  // steps still close on backdrop click / Escape.
  const handleClose = () => {
    if (step === "terms" || submitting) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="First-time setup"
      maxWidth={step === "terms" ? "max-w-2xl" : "max-w-md"}
    >
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
                You&apos;re all set!
              </h3>
              <p className="mt-1 text-[14px] text-ink-500">
                Password created for{" "}
                <span className="font-semibold">+91 {mobile}</span>. Taking you to the shop…
              </p>
              <button
                type="button"
                onClick={onComplete}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all"
              >
                Go to shop <ArrowRight className="h-4 w-4" />
              </button>
            </motion.div>
          ) : step === "terms" ? (
            <motion.div
              key="terms"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand">
                Before you continue
              </p>
              <h3 className="mt-2 font-display text-[22px] font-extrabold text-ink-900 leading-tight">
                Terms &amp; Conditions
              </h3>
              <p className="mt-1 text-[13px] text-ink-500">
                Please read and accept the policies below to finish setting
                up your account.
              </p>

              {/* Scrollable policy text — keeps the modal a usable height
                   even on small screens. */}
              <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-ink-200 bg-cream-50/50 p-4 pr-3 text-[13px] leading-relaxed text-ink-700 space-y-3">
                {TC_SECTIONS.map((s) => (
                  <section key={s.heading}>
                    <h4 className="text-[13px] font-bold text-ink-900">
                      {s.heading}
                    </h4>
                    {s.paragraphs.map((p, i) => (
                      <p key={i} className="mt-1">{p}</p>
                    ))}
                  </section>
                ))}
                <p className="pt-1 text-[11px] text-ink-500 font-mono">
                  Version {TC_VERSION}
                </p>
              </div>

              <div className="mt-4 space-y-2">
                {TC_REQUIRED_CHECKS.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-start gap-2.5 cursor-pointer text-[13px] text-ink-800 leading-snug"
                  >
                    <input
                      type="checkbox"
                      checked={acceptedChecks[c.id] === true}
                      onChange={(e) =>
                        setAcceptedChecks((m) => ({
                          ...m,
                          [c.id]: e.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 accent-brand flex-shrink-0"
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>

              {error && (
                <p className="mt-3 text-[12px] font-medium text-red-500">
                  {error}
                </p>
              )}

              <button
                type="button"
                disabled={!allChecksTicked || submitting}
                onClick={acceptAndComplete}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShieldCheck className="h-4 w-4" />
                {submitting ? "Finalising…" : "I accept & continue"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setError(undefined);
                  setStep("password");
                }}
                className="mt-3 w-full text-[12px] font-semibold text-ink-500 hover:text-ink-900 disabled:opacity-50"
              >
                ← Back to password
              </button>
            </motion.div>
          ) : (
            <motion.form
              key={step}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={step === "otp" ? verifyOtpStep : submit}
            >
              <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand">
                First-time sign-in
              </p>
              <h3 className="mt-2 font-display text-[22px] font-extrabold text-ink-900 leading-tight">
                {step === "otp" ? "Verify your OTP" : "Create a password"}
              </h3>
              <p className="mt-1 text-[13px] text-ink-500">
                {step === "otp" ? (
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
                    . Set a password to finish.
                  </>
                )}
              </p>

              {step === "otp" ? (
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
              ) : (
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
                      placeholder="Create password"
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
                      {showPwd ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <input
                    type={showPwd ? "text" : "password"}
                    placeholder="Confirm password"
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
                <p className="mt-3 text-[12px] font-medium text-red-500">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 active:scale-[0.99] transition-all disabled:opacity-60"
              >
                {step === "otp"
                  ? submitting
                    ? "Verifying…"
                    : "Verify OTP"
                  : "Continue"}
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
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
