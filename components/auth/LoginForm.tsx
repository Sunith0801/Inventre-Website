"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  KeyRound,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react";
import { MobileInput } from "./MobileInput";
import { OtpModal } from "./OtpModal";
import { FirstTimeModal } from "./FirstTimeModal";
import { ForgotMobileModal } from "./ForgotMobileModal";
import { ForgotPasswordModal } from "./ForgotPasswordModal";
import { TermsAcceptanceModal } from "./TermsAcceptanceModal";
import { StudentSearch, type FoundStudent } from "./StudentSearch";
import { Modal } from "@/components/ui/Modal";
import { auth } from "@/lib/auth";
import { TC_VERSION } from "@/lib/legal/terms";

/**
 * Unified parent sign-in. One entry — the phone — branches automatically:
 *
 *   • Registered + password   → password field (with OTP escape hatch).
 *   • Registered, passwordless → OTP sent, OtpModal opens.
 *   • First-time setup (admin-added) → /api/auth/phone-status flags it; we
 *       send the OTP and open FirstTimeModal.
 *   • Not registered           → inline student-search panel: pick your
 *       child, the recovery modal opens preselected and offers
 *       "Change my mobile" or "Add another mobile".
 *
 * No separate New-User tab — the recovery/add-mobile flow is the path for
 * any number we don't yet know.
 */
export function LoginForm() {
  const router = useRouter();

  const [mobile, setMobile] = useState("");
  const [otpOpen, setOtpOpen] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [forgotMobileOpen, setForgotMobileOpen] = useState(false);
  const [forgotMobileSeed, setForgotMobileSeed] = useState<FoundStudent | null>(
    null,
  );
  const [forgotPwdOpen, setForgotPwdOpen] = useState(false);
  const [firstTimeOpen, setFirstTimeOpen] = useState(false);
  // Gates the final redirect to /shop on every non-first-time login.
  // Policy: T&C acceptance is re-requested on every login regardless of
  // whether the user has accepted before. First-time login is exempt
  // because its own flow already includes a T&C step.
  const [tcOpen, setTcOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Stages: "mobile" — phone entry; "auth" — password field for known users
  // with a password on file. The "unknown phone" surface is rendered inline
  // on the "mobile" stage rather than as its own stage so the user can edit
  // and retry without losing the search results.
  const [stage, setStage] = useState<"mobile" | "auth">("mobile");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [errors, setErrors] = useState<{
    mobile?: string;
    password?: string;
    form?: string;
  }>({});
  // Shown when the entered phone is not registered. Drives the inline
  // student-search panel below the mobile input.
  const [unknownPhone, setUnknownPhone] = useState(false);

  const goShop = () => {
    setLoginSuccess(true);
    setTimeout(() => router.push("/shop"), 1200);
  };

  // Single entry point used by every login-success handler. Re-fetches
  // the session, and if the parent has already accepted the current
  // TC_VERSION, skips straight to /shop. Otherwise it pops the T&C modal
  // so they can tick through before proceeding. First-time login is
  // unaffected — that flow accepts T&C inside its own steps and calls
  // goShop() directly.
  const finishLoginViaTc = async () => {
    try {
      const user = await auth.me();
      if (
        user?.kind === "parent" &&
        user.tcAcceptedAt &&
        user.tcAcceptedVersion === TC_VERSION
      ) {
        goShop();
        return;
      }
    } catch {
      // Fall through to the modal if /me fails for any reason — the
      // worst case is the parent re-accepts the current terms.
    }
    setTcOpen(true);
  };

  const onContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobile.length !== 10) {
      setErrors({ mobile: "Enter a valid 10-digit mobile number" });
      return;
    }
    setSubmitting(true);
    setErrors({});
    setUnknownPhone(false);
    try {
      const status = await auth.phoneStatus(mobile);
      if (!status.registered) {
        // Surface the inline "find your child" panel instead of a hard
        // error — the parent likely has a different number on file.
        setSubmitting(false);
        setUnknownPhone(true);
        return;
      }
      if (status.hasPassword) {
        // Policy: OTP is the default after mobile entry; password is the
        // fallback (reachable via "Use password instead" inside OtpModal).
        // We request the OTP eagerly so the modal opens with the timer
        // already running, matching the prior password-stage feel.
        await auth.requestOtp(mobile);
        setSubmitting(false);
        setOtpOpen(true);
        return;
      }
      // No password on file → first-time setup: OTP, then create
      // password, then logged in. Both fresh families and admin-added
      // parents go through this same flow on their first sign-in.
      await auth.requestOtp(mobile);
      setSubmitting(false);
      setFirstTimeOpen(true);
    } catch (err) {
      setSubmitting(false);
      setErrors({
        form: err instanceof Error ? err.message : "Something went wrong",
      });
    }
  };

  const onPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setErrors({ password: "Password must be at least 6 characters" });
      return;
    }
    setSubmitting(true);
    setErrors({});
    try {
      await auth.loginWithPassword(mobile, password);
      setSubmitting(false);
      finishLoginViaTc();
    } catch (err) {
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      if (/first-?time/i.test(msg)) {
        try {
          await auth.requestOtp(mobile);
          setFirstTimeOpen(true);
        } catch {}
        return;
      }
      setErrors({ form: msg });
    }
  };

  const onUseOtpInstead = async () => {
    setSubmitting(true);
    setErrors({});
    try {
      await auth.requestOtp(mobile);
      setSubmitting(false);
      setOtpOpen(true);
    } catch (err) {
      setSubmitting(false);
      setErrors({
        form: err instanceof Error ? err.message : "Couldn't send OTP",
      });
    }
  };

  const onOtpVerified = () => {
    setOtpOpen(false);
    finishLoginViaTc();
  };

  const onFirstTimeComplete = () => {
    setFirstTimeOpen(false);
    // First-time flow already includes a T&C step — don't show again.
    goShop();
  };

  // From the unknown-phone panel: the parent picked their student. Open
  // the recovery modal preselected so they don't re-pick.
  const onPickUnknownStudent = (s: FoundStudent) => {
    setForgotMobileSeed(s);
    setForgotMobileOpen(true);
  };

  // From the recovery modal in "add" mode: the new number was registered
  // as an extra guardian link. Drop the user back on the main form
  // pre-filled with that number and trigger the normal OTP flow.
  const onMobileAdded = async (newPhone: string) => {
    setForgotMobileOpen(false);
    setForgotMobileSeed(null);
    setMobile(newPhone);
    setUnknownPhone(false);
    setStage("mobile");
    try {
      await auth.requestOtp(newPhone);
      setOtpOpen(true);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : "Couldn't send OTP",
      });
    }
  };

  const field =
    "mt-1.5 w-full px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 rounded-xl border border-ink-200 bg-white outline-none focus:border-ink-900";
  const primaryBtn =
    "mt-2 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 active:scale-[0.99] transition-all disabled:opacity-60";

  return (
    <>
      <div className="w-full max-w-md mx-auto">
        <div className="lg:hidden mb-8 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/INVENTRE_LOGO.png"
            alt="Inventre"
            className="h-8 w-auto"
          />
        </div>

        <p className="text-[12px] font-semibold tracking-[0.18em] uppercase text-brand">
          Parent Sign-In
        </p>
        <h1 className="mt-2 font-display text-[32px] sm:text-[38px] font-extrabold tracking-tight text-ink-900 leading-[1.05]">
          Welcome.
        </h1>
        <p className="mt-2 text-[14.5px] text-ink-500">
          Enter your mobile number — we&apos;ll text you a code or take you to
          your password.
        </p>

        {stage === "mobile" && (
          <>
            <form onSubmit={onContinue} className="mt-8 space-y-4">
              <MobileInput
                value={mobile}
                onChange={(v) => {
                  setMobile(v);
                  if (errors.mobile)
                    setErrors({ ...errors, mobile: undefined });
                  if (unknownPhone) setUnknownPhone(false);
                }}
                error={errors.mobile}
                autoFocus
              />
              {errors.form && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
                  {errors.form}
                </div>
              )}
              <button type="submit" disabled={submitting} className={primaryBtn}>
                {submitting ? "Checking…" : "Continue"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            {unknownPhone && (
              <div className="mt-6 rounded-2xl border border-brand/30 bg-brand/5 p-4">
                <p className="text-[13px] text-ink-800">
                  We don&apos;t see{" "}
                  <span className="font-semibold">+91 {mobile}</span> on file.
                  Find your child below to recover access — you&apos;ll be able
                  to change the existing number to this one, or add this as an
                  extra guardian.
                </p>
                <div className="mt-4">
                  <StudentSearch onPick={onPickUnknownStudent} showMasked />
                </div>
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-ink-100 bg-white/60 p-4 text-center">
              <p className="text-[13px] text-ink-600">
                Changed or forgot your registered mobile number?
              </p>
              <button
                type="button"
                onClick={() => {
                  setForgotMobileSeed(null);
                  setForgotMobileOpen(true);
                }}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-full border border-brand/40 bg-brand/5 text-brand h-11 px-5 text-[13px] font-bold hover:bg-brand/10 transition-colors"
              >
                <KeyRound className="h-4 w-4" />
                Recover, change or add a mobile via student details
              </button>
            </div>
          </>
        )}

        {stage === "auth" && (
          <>
            <form onSubmit={onPasswordSubmit} className="mt-8 space-y-4">
              <button
                type="button"
                onClick={() => {
                  setStage("mobile");
                  setPassword("");
                  setErrors({});
                }}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-500 hover:text-ink-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Use a different mobile
              </button>
              <div className="rounded-xl border border-ink-200 bg-cream-100 px-4 py-3 text-[13px] text-ink-700">
                Signing in as{" "}
                <span className="font-semibold text-ink-900">+91 {mobile}</span>
              </div>
              <label className="block">
                <span className="text-[12.5px] font-semibold tracking-wide uppercase text-ink-500">
                  Password
                </span>
                <div
                  className={
                    "mt-1.5 flex items-stretch rounded-xl border bg-white overflow-hidden focus-within:border-ink-900 " +
                    (errors.password ? "border-red-300" : "border-ink-200")
                  }
                >
                  <input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password)
                        setErrors({ ...errors, password: undefined });
                    }}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="flex-1 px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 outline-none bg-transparent"
                    autoFocus
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
                {errors.password && (
                  <p className="mt-1 text-[12px] font-medium text-red-500">
                    {errors.password}
                  </p>
                )}
              </label>
              {errors.form && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
                  {errors.form}
                </div>
              )}
              <button type="submit" disabled={submitting} className={primaryBtn}>
                {submitting ? "Signing in…" : "Sign in"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>

              <div className="flex items-center justify-between text-[12.5px]">
                <button
                  type="button"
                  onClick={onUseOtpInstead}
                  disabled={submitting}
                  className="font-semibold text-brand hover:text-brand-700 disabled:opacity-60"
                >
                  Login with OTP
                </button>
                <button
                  type="button"
                  onClick={() => setForgotPwdOpen(true)}
                  className="font-semibold text-ink-500 hover:text-ink-900"
                >
                  Forgot password?
                </button>
              </div>
            </form>
          </>
        )}

        <p className="mt-8 text-center text-[12px] text-ink-500">
          Trouble signing in? Email{" "}
          <a
            href="mailto:support@inventre.in"
            className="font-semibold text-ink-800 hover:text-brand"
          >
            support@inventre.in
          </a>
        </p>
      </div>

      <OtpModal
        open={otpOpen}
        mobile={mobile}
        onClose={() => setOtpOpen(false)}
        onVerified={onOtpVerified}
        onUsePasswordInstead={() => {
          setOtpOpen(false);
          setStage("auth");
        }}
      />
      <FirstTimeModal
        open={firstTimeOpen}
        mobile={mobile}
        onClose={() => setFirstTimeOpen(false)}
        onComplete={onFirstTimeComplete}
      />
      <ForgotMobileModal
        open={forgotMobileOpen}
        initialPicked={forgotMobileSeed}
        seedNewPhone={
          // Only seed the new-phone fields if we arrived here from the
          // unknown-phone panel — i.e. there's a picked student carried
          // over. The backup "Recover or change…" link should leave them
          // blank so the parent types the destination number explicitly.
          forgotMobileSeed && mobile.length === 10 ? mobile : undefined
        }
        onClose={() => {
          setForgotMobileOpen(false);
          setForgotMobileSeed(null);
        }}
        onRecovered={() => {
          setForgotMobileOpen(false);
          setForgotMobileSeed(null);
          finishLoginViaTc();
        }}
        onMobileAdded={onMobileAdded}
      />
      <ForgotPasswordModal
        open={forgotPwdOpen}
        onClose={() => setForgotPwdOpen(false)}
      />
      <TermsAcceptanceModal
        open={tcOpen}
        onAccepted={() => {
          setTcOpen(false);
          goShop();
        }}
      />

      <Modal
        open={loginSuccess}
        onClose={() => {}}
        title="Signed in"
        maxWidth="max-w-sm"
      >
        <div className="p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 border border-emerald-200">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          </div>
          <h3 className="mt-4 font-display text-[22px] font-extrabold text-ink-900">
            Login successful
          </h3>
          <p className="mt-1 text-[14px] text-ink-500">
            Taking you to your shop…
          </p>
        </div>
      </Modal>
    </>
  );
}
