"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ArrowRight, ArrowLeft, Mail } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { auth } from "@/lib/auth";
import { StudentSearch, type FoundStudent } from "./StudentSearch";

type Student = FoundStudent;

const RELATIONS = [
  "Father",
  "Mother",
  "Brother",
  "Sister",
  "Grandparent",
  "Uncle",
  "Aunt",
  "Guardian",
] as const;
type Relation = (typeof RELATIONS)[number];

/**
 * "Forgot my mobile number" recovery — two paths and two modes.
 *
 * Paths (identity proof):
 *   A — I know my old number: enter old phone → OTP.
 *   B — "Try another way": registered-email OTP.
 *
 * Modes (action after identity proof):
 *   change — overwrite parents.phone + the matching student_guardian_links row;
 *            sign the parent straight in (Path A) or after new-number OTP (Path B).
 *   add    — INSERT a new student_guardian_links row with a new guardian name,
 *            relation and phone. Does NOT create a session — the parent then
 *            signs in with the new phone via the normal OTP flow.
 *
 * `initialPicked` lets callers (the login form's "phone not registered"
 * panel) pre-seed the student and skip the search step.
 */
export function ForgotMobileModal({
  open,
  onClose,
  onRecovered,
  onMobileAdded,
  initialPicked,
  seedNewPhone,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired after change-mode flows land on the "Signed in" screen. */
  onRecovered: (phoneNow: string) => void;
  /** Fired after add-mode finishes — caller pre-fills the login form with
   *  the new number and triggers the OTP modal. No session yet. */
  onMobileAdded?: (newPhone: string) => void;
  initialPicked?: Student | null;
  /** If the parent reached this modal because the number they typed on
   *  the login form was unrecognised, that number is the implicit target
   *  for both change-mode and add-mode. We pre-fill the new-phone fields
   *  with it so they don't have to type it again — the modal still asks
   *  for confirmation so an accidental seed can be edited. */
  seedNewPhone?: string;
}) {
  const [step, setStep] = useState<"find" | "recover" | "done">("find");
  type RPhase =
    | "oldPhone"     // entry — either continue with old phone OR "try another way"
    | "oldOtp"       // Path A
    | "emailIntro"   // Path B — show masked email + send OTP button
    | "emailOtp"     // Path B — verify email OTP
    | "newPhone"     // change-mode: new mobile + confirm
    | "newOtp"       // change-mode: verify new mobile
    | "addDetails"   // add-mode: guardian name + relation + new phone
    | "addOtp";      // add-mode: verify the new-phone OTP
  const [rphase, setRphase] = useState<RPhase>("oldPhone");
  const [mode, setMode] = useState<"change" | "add">("change");

  const [picked, setPicked] = useState<Student | null>(null);

  const [oldPhone, setOldPhone] = useState("");
  const [oldOtp, setOldOtp] = useState("");
  const [emailMasked, setEmailMasked] = useState<string>("");
  const [emailOtp, setEmailOtp] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [confirmNew, setConfirmNew] = useState("");
  const [newOtp, setNewOtp] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [relation, setRelation] = useState<Relation>("Father");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The /done screen needs to know which phone is now active (for the
  // "Signed in with …" line) without re-deriving from path state.
  const [phoneNow, setPhoneNow] = useState("");
  // After add-mode finishes the done screen says "Number added — sign in"
  // instead of "Signed in" — track that explicitly.
  const [doneMode, setDoneMode] = useState<"change" | "add">("change");

  useEffect(() => {
    if (!open) return;
    const seed = initialPicked ?? null;
    const seededPhone = seedNewPhone ?? "";
    setStep(seed ? "recover" : "find");
    setRphase("oldPhone");
    setMode("change");
    setPicked(seed);
    setOldPhone("");
    setOldOtp("");
    setEmailMasked("");
    setEmailOtp("");
    setNewPhone(seededPhone);
    setConfirmNew(seededPhone);
    setNewOtp("");
    setGuardianName("");
    setRelation("Father");
    setPhoneNow("");
    setDoneMode("change");
    setBusy(false);
    setError(undefined);
  }, [open, initialPicked, seedNewPhone]);

  const pick = (s: Student) => {
    setPicked(s);
    setStep("recover");
    setRphase("oldPhone");
    setError(undefined);
  };

  // ── Path A: old phone ────────────────────────────────────────────
  const sendOldOtp = async () => {
    if (!picked) return;
    if (oldPhone.length !== 10)
      return setError("Enter the 10-digit old mobile number.");
    setBusy(true);
    setError(undefined);
    try {
      await auth.recoverRequestOtp(picked.studentId, oldPhone);
      setBusy(false);
      setRphase("oldOtp");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Couldn't send OTP");
    }
  };

  // Old-phone OTP verified. Both modes need the SAME server semantics here:
  // set the recovery marker but DON'T sign in — the parent still has to
  // commit the new phone (change → replace, add → add a new link row)
  // before any session is created. We pass intent="add" for both because
  // it's the existing "set marker, no session" code path on the server.
  // The actual change/add divergence lives in the next phase the modal
  // routes to.
  const verifyOldPhoneOtp = async () => {
    if (!picked) return;
    if (oldOtp.length !== 6) return setError("Enter the 6-digit OTP.");
    setBusy(true);
    setError(undefined);
    try {
      await auth.recoverVerifyOld(picked.studentId, oldPhone, oldOtp, "add");
      setBusy(false);
      if (mode === "change") setRphase("newPhone");
      else setRphase("addDetails");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Verification failed");
    }
  };

  // ── Path B: email ─────────────────────────────────────────────────
  const startEmailPath = async () => {
    if (!picked) return;
    setBusy(true);
    setError(undefined);
    try {
      const o = await auth.recoverEmailOptions(picked.studentId);
      setBusy(false);
      if (!o.hasEmail) {
        setError(
          "We couldn't find any email registered with your account. Please contact customer service."
        );
        return;
      }
      setEmailMasked(o.emailMasked ?? "");
      setRphase("emailIntro");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const sendEmailOtp = async () => {
    if (!picked) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await auth.recoverRequestEmailOtp(picked.studentId);
      setBusy(false);
      setEmailMasked(r.emailMasked);
      setRphase("emailOtp");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Couldn't send email");
    }
  };

  // Email OTP verified → next step depends on mode.
  const verifyEmail = async () => {
    if (!picked) return;
    if (emailOtp.length !== 6) return setError("Enter the 6-digit OTP.");
    setBusy(true);
    setError(undefined);
    try {
      await auth.recoverVerifyEmailOtp(picked.studentId, emailOtp);
      setBusy(false);
      if (mode === "change") setRphase("newPhone");
      else setRphase("addDetails");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Verification failed");
    }
  };

  // ── change-mode: new phone OTP + commit ───────────────────────────
  const sendNewOtp = async () => {
    if (!picked) return;
    if (newPhone.length !== 10)
      return setError("Enter the new 10-digit mobile number.");
    if (newPhone !== confirmNew) return setError("New numbers do not match.");
    setBusy(true);
    setError(undefined);
    try {
      await auth.recoverRequestNewOtp({
        studentId: picked.studentId,
        oldPhone: oldPhone || undefined,
        newPhone,
      });
      setBusy(false);
      setRphase("newOtp");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Couldn't send OTP");
    }
  };

  const verifyNewAndFinish = async () => {
    if (!picked) return;
    if (newOtp.length !== 6) return setError("Enter the 6-digit OTP.");
    setBusy(true);
    setError(undefined);
    try {
      await auth.recoverConfirm({
        studentId: picked.studentId,
        oldPhone: oldPhone || undefined,
        otp: newOtp,
        newPhone,
      });
      setBusy(false);
      setPhoneNow(newPhone);
      setDoneMode("change");
      setStep("done");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  // ── add-mode: details → OTP → insert link row ─────────────────────
  const sendAddOtp = async () => {
    if (!picked) return;
    if (guardianName.trim().length < 2)
      return setError("Enter the guardian's name.");
    if (newPhone.length !== 10)
      return setError("Enter the new 10-digit mobile number.");
    if (newPhone !== confirmNew) return setError("New numbers do not match.");
    setBusy(true);
    setError(undefined);
    try {
      await auth.recoverRequestAddOtp({
        studentId: picked.studentId,
        oldPhone: oldPhone || undefined,
        newPhone,
      });
      setBusy(false);
      setRphase("addOtp");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Couldn't send OTP");
    }
  };

  const verifyAddAndFinish = async () => {
    if (!picked) return;
    if (newOtp.length !== 6) return setError("Enter the 6-digit OTP.");
    setBusy(true);
    setError(undefined);
    try {
      await auth.recoverAddMobile({
        studentId: picked.studentId,
        oldPhone: oldPhone || undefined,
        otp: newOtp,
        newPhone,
        guardianName: guardianName.trim(),
        relation,
      });
      setBusy(false);
      setPhoneNow(newPhone);
      setDoneMode("add");
      setStep("done");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not add mobile");
    }
  };

  const field =
    "w-full px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 rounded-xl border border-ink-200 bg-white outline-none focus:border-ink-900";
  const otpField = field + " tracking-[0.4em] font-mono";

  const stepLabel =
    rphase === "oldPhone" || rphase === "oldOtp"
      ? "Step 2 — Verify your old number"
      : rphase === "emailIntro" || rphase === "emailOtp"
        ? "Step 2 — Verify your registered email"
        : rphase === "addDetails" || rphase === "addOtp"
          ? "Step 3 — Add a new guardian"
          : "Step 3 — Set a new number";

  // The Change/Add toggle is hidden on the OTP-entry phases so users don't
  // switch mode mid-OTP and end up calling the wrong commit endpoint.
  const showModeToggle =
    rphase === "oldPhone" || rphase === "emailIntro" || rphase === "newPhone";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "add" ? "Add another mobile number" : "Recover your mobile number"}
      maxWidth="max-w-lg"
    >
      <div className="p-6 sm:p-8">
        <AnimatePresence mode="wait">
          {step === "find" && (
            <motion.div
              key="find"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-brand">
                Step 1 — Find your child
              </p>
              <h3 className="mt-2 font-display text-[22px] font-extrabold text-ink-900">
                Search by school, grade &amp; name
              </h3>
              <p className="mt-1 text-[13px] text-ink-500">
                Pick your child below — we&apos;ll show the last 4 digits of
                the number on file so you can use it to log in.
              </p>
              <div className="mt-5">
                <StudentSearch onPick={pick} showMasked />
              </div>
            </motion.div>
          )}

          {step === "recover" && picked && (
            <motion.div
              key="recover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <button
                type="button"
                onClick={() => {
                  setStep("find");
                  setRphase("oldPhone");
                  setError(undefined);
                }}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-500 hover:text-ink-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to search
              </button>

              <h3 className="mt-3 font-display text-[20px] font-extrabold text-ink-900">
                {picked.name}
              </h3>
              <p className="text-[12px] text-ink-500">
                {picked.enrollment} · {picked.school}
                {picked.phones.length > 0 && (
                  <>
                    {" · "}
                    {picked.phones.map((ph, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {ph.relation ? `${ph.relation} ` : ""}
                        {ph.mobileMasked}
                      </span>
                    ))}
                  </>
                )}
              </p>

              {showModeToggle && (
                <div
                  role="tablist"
                  aria-label="What do you want to do"
                  className="mt-4 inline-flex rounded-full bg-cream-100 border border-ink-200 p-1 text-[12px] font-semibold"
                >
                  {(
                    [
                      { id: "change" as const, label: "Change my mobile" },
                      { id: "add" as const, label: "Add another mobile" },
                    ]
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="tab"
                      aria-selected={mode === m.id}
                      onClick={() => {
                        setMode(m.id);
                        setError(undefined);
                      }}
                      className={
                        "px-3.5 h-8 rounded-full transition-colors " +
                        (mode === m.id
                          ? "bg-ink-900 text-white"
                          : "text-ink-600 hover:text-ink-900")
                      }
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              <p className="mt-4 text-[11px] font-semibold tracking-[0.16em] uppercase text-brand">
                {stepLabel}
              </p>

              {/* ── Identity: old number entry ─────────────────────── */}
              {rphase === "oldPhone" && (
                <div className="mt-3 space-y-3">
                  <p className="text-[12px] text-ink-500">
                    Enter any of the mobile numbers on file
                    {picked.phones.length > 0 ? " (" : ""}
                    {picked.phones.map((ph, i) => (
                      <span key={i} className="font-semibold text-ink-700">
                        {i > 0 ? ", " : ""}
                        {ph.relation ? `${ph.relation} ` : ""}
                        {ph.mobileMasked.slice(-4)}
                      </span>
                    ))}
                    {picked.phones.length > 0 ? ")" : ""}
                    . We&apos;ll send a one-time code to verify it&apos;s you.
                  </p>
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    value={oldPhone}
                    onChange={(e) =>
                      setOldPhone(
                        e.target.value.replace(/\D/g, "").slice(0, 10)
                      )
                    }
                    placeholder="Old mobile number (10 digits)"
                    className={field}
                  />
                  <button
                    type="button"
                    onClick={sendOldOtp}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all disabled:opacity-60"
                  >
                    {busy ? "Sending…" : "Send OTP to old number"}
                  </button>
                  <button
                    type="button"
                    onClick={startEmailPath}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-ink-200 bg-white text-ink-700 h-11 px-6 text-[13px] font-semibold hover:border-brand hover:text-brand transition-all disabled:opacity-60"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Try another way (email)
                  </button>
                </div>
              )}

              {/* ── Identity: old-number OTP ───────────────────────── */}
              {rphase === "oldOtp" && (
                <div className="mt-3 space-y-3">
                  <p className="text-[12px] text-ink-500">
                    OTP sent to your old number.{" "}
                    {mode === "change"
                      ? "Enter it to sign in."
                      : "Enter it to continue."}
                  </p>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={oldOtp}
                    onChange={(e) =>
                      setOldOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="6-digit OTP"
                    className={otpField}
                  />
                  <button
                    type="button"
                    onClick={verifyOldPhoneOtp}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all disabled:opacity-60"
                  >
                    {busy
                      ? "Verifying…"
                      : mode === "change"
                        ? "Verify & sign in"
                        : "Verify & continue"}
                    {!busy && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
              )}

              {/* ── Path B · email intro ──────────────────────────── */}
              {rphase === "emailIntro" && (
                <div className="mt-3 space-y-3">
                  <p className="text-[12px] text-ink-500">
                    We&apos;ll send a one-time code to the email registered
                    with this account:
                  </p>
                  <div className="rounded-xl border border-ink-200 bg-cream-100 px-4 py-3 font-mono text-[14px] text-ink-800">
                    {emailMasked || "—"}
                  </div>
                  <button
                    type="button"
                    onClick={sendEmailOtp}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all disabled:opacity-60"
                  >
                    <Mail className="h-4 w-4" />
                    {busy ? "Sending…" : "Send OTP to email"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRphase("oldPhone");
                      setError(undefined);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 text-[12px] font-medium text-ink-500 hover:text-ink-900"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to mobile
                  </button>
                </div>
              )}

              {/* ── Path B · email OTP ───────────────────────────── */}
              {rphase === "emailOtp" && (
                <div className="mt-3 space-y-3">
                  <p className="text-[12px] text-ink-500">
                    OTP sent to{" "}
                    <span className="font-mono text-ink-800">
                      {emailMasked}
                    </span>
                    . Check your inbox (and spam).
                  </p>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={emailOtp}
                    onChange={(e) =>
                      setEmailOtp(
                        e.target.value.replace(/\D/g, "").slice(0, 6)
                      )
                    }
                    placeholder="6-digit OTP"
                    className={otpField}
                  />
                  <button
                    type="button"
                    onClick={verifyEmail}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all disabled:opacity-60"
                  >
                    {busy ? "Verifying…" : "Verify email"}
                    {!busy && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
              )}

              {/* ── change-mode · new mobile ─────────────────────── */}
              {rphase === "newPhone" && (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12px] text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    Identity verified. Enter your new mobile number.
                  </div>
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    value={newPhone}
                    onChange={(e) =>
                      setNewPhone(
                        e.target.value.replace(/\D/g, "").slice(0, 10)
                      )
                    }
                    placeholder="New mobile number"
                    className={field}
                  />
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    value={confirmNew}
                    onChange={(e) =>
                      setConfirmNew(
                        e.target.value.replace(/\D/g, "").slice(0, 10)
                      )
                    }
                    placeholder="Confirm new mobile number"
                    className={field}
                  />
                  <button
                    type="button"
                    onClick={sendNewOtp}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all disabled:opacity-60"
                  >
                    {busy ? "Sending…" : "Send OTP to new number"}
                  </button>
                </div>
              )}

              {/* ── change-mode · new mobile OTP ─────────────────── */}
              {rphase === "newOtp" && (
                <div className="mt-3 space-y-3">
                  <p className="text-[12px] text-ink-500">
                    OTP sent to{" "}
                    <span className="font-semibold text-ink-800">
                      +91 {newPhone}
                    </span>
                    . Verify to finish.
                  </p>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={newOtp}
                    onChange={(e) =>
                      setNewOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="6-digit OTP"
                    className={otpField}
                  />
                  <button
                    type="button"
                    onClick={verifyNewAndFinish}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all disabled:opacity-60"
                  >
                    {busy ? "Verifying…" : "Verify & sign in"}
                    {!busy && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
              )}

              {/* ── add-mode · details ──────────────────────────── */}
              {rphase === "addDetails" && (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12px] text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    Identity verified. Add a new guardian to this student.
                  </div>
                  <input
                    value={guardianName}
                    onChange={(e) => setGuardianName(e.target.value)}
                    placeholder="Guardian's full name"
                    className={field}
                  />
                  <select
                    value={relation}
                    onChange={(e) => setRelation(e.target.value as Relation)}
                    className={field}
                  >
                    {RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    value={newPhone}
                    onChange={(e) =>
                      setNewPhone(
                        e.target.value.replace(/\D/g, "").slice(0, 10)
                      )
                    }
                    placeholder="New mobile number"
                    className={field}
                  />
                  <input
                    inputMode="numeric"
                    maxLength={10}
                    value={confirmNew}
                    onChange={(e) =>
                      setConfirmNew(
                        e.target.value.replace(/\D/g, "").slice(0, 10)
                      )
                    }
                    placeholder="Confirm new mobile number"
                    className={field}
                  />
                  <button
                    type="button"
                    onClick={sendAddOtp}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all disabled:opacity-60"
                  >
                    {busy ? "Sending…" : "Send OTP to new number"}
                  </button>
                </div>
              )}

              {/* ── add-mode · new-number OTP ───────────────────── */}
              {rphase === "addOtp" && (
                <div className="mt-3 space-y-3">
                  <p className="text-[12px] text-ink-500">
                    OTP sent to{" "}
                    <span className="font-semibold text-ink-800">
                      +91 {newPhone}
                    </span>
                    . Verify to finish adding this number.
                  </p>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={newOtp}
                    onChange={(e) =>
                      setNewOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="6-digit OTP"
                    className={otpField}
                  />
                  <button
                    type="button"
                    onClick={verifyAddAndFinish}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all disabled:opacity-60"
                  >
                    {busy ? "Verifying…" : "Add this number"}
                    {!busy && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
              )}

              {error && (
                <p className="mt-3 text-[12px] font-medium text-red-500">
                  {error}
                </p>
              )}
            </motion.div>
          )}

          {step === "done" && (
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
                {doneMode === "add" ? "Number added" : "Signed in"}
              </h3>
              <p className="mt-1 text-[14px] text-ink-500">
                {doneMode === "add" ? (
                  <>
                    Sign in with{" "}
                    <span className="font-semibold">+91 {phoneNow}</span> to
                    continue.
                  </>
                ) : (
                  <>
                    Welcome back. You&apos;re using{" "}
                    <span className="font-semibold">+91 {phoneNow}</span>.
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (doneMode === "add") {
                    onMobileAdded?.(phoneNow);
                  } else {
                    onRecovered(phoneNow);
                  }
                }}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 transition-all"
              >
                {doneMode === "add" ? (
                  <>
                    Sign in with new number <ArrowRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Continue to shop <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
