"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { auth } from "@/lib/auth";

function maskMobile(m: string) {
  if (m.length < 10) return `+91 ${m}`;
  return `+91 ${m.slice(0, 2)}xxx xx${m.slice(8)}`;
}

export function OtpModal({
  open,
  mobile,
  onClose,
  onVerified,
  onUsePasswordInstead,
}: {
  open: boolean;
  mobile: string;
  onClose: () => void;
  onVerified: (firstTime?: boolean) => void;
  onUsePasswordInstead?: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [seconds, setSeconds] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string>();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    setDigits(["", "", "", "", "", ""]);
    setSeconds(30);
    setSubmitting(false);
    setVerified(false);
    setError(undefined);
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
    if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) inputs.current[i + 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = ["", "", "", "", "", ""];
    text.split("").forEach((c, i) => (next[i] = c));
    setDigits(next);
    inputs.current[Math.min(text.length, 5)]?.focus();
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = digits.join("");
    if (code.length < 6) {
      setError("Enter the complete 6-digit code");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const r = await auth.verifyOtp(mobile, code);
      setSubmitting(false);
      setVerified(true);
      setTimeout(() => onVerified(r.firstTime), 1200);
    } catch (err) {
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : "Verification failed";
      setError(msg);
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
    <Modal open={open} onClose={onClose} title="Enter OTP" maxWidth="max-w-md">
      <div className="p-6 sm:p-8">
        <AnimatePresence mode="wait">
          {verified ? (
            <motion.div
              key="ok"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-6"
            >
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h3 className="mt-4 font-display text-[22px] font-extrabold text-ink-900">
                Verified
              </h3>
              <p className="mt-1 text-[14px] text-ink-500">
                Taking you to your shop…
              </p>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={submit}
            >
              <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand">
                Verification
              </p>
              <h3 className="mt-2 font-display text-[24px] font-extrabold text-ink-900 leading-tight">
                Enter the 6-digit code
              </h3>
              <p className="mt-1 text-[13px] text-ink-500">
                Sent to{" "}
                <span className="font-semibold text-ink-800">
                  {maskMobile(mobile)}
                </span>
              </p>

              <div className="mt-6 flex gap-2 justify-between">
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
                    aria-label={`Digit ${i + 1}`}
                    className="h-14 w-12 sm:w-14 rounded-xl border border-ink-200 bg-white text-center font-display text-[22px] font-bold text-ink-900 tabular-nums focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                  />
                ))}
              </div>

              {error && (
                <p className="mt-3 text-[12px] font-medium text-red-500">
                  {error}
                </p>
              )}

              <div className="mt-3 text-[12.5px] text-ink-500">
                {seconds > 0 ? (
                  <span>
                    Didn&apos;t get it? Resend in{" "}
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

              <button
                type="submit"
                disabled={submitting}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Verifying…" : "Verify & continue"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>

              {onUsePasswordInstead && (
                <button
                  type="button"
                  onClick={onUsePasswordInstead}
                  className="mt-3 w-full text-[12.5px] font-semibold text-ink-500 hover:text-ink-900 transition-colors"
                >
                  Use password instead
                </button>
              )}
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
