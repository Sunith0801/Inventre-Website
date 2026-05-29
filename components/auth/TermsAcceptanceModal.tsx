"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, ArrowRight, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { TC_SECTIONS, TC_REQUIRED_CHECKS, TC_VERSION } from "@/lib/legal/terms";
import { auth } from "@/lib/auth";

/**
 * T&C acceptance modal that pops up after every (non-first-time) login,
 * before the parent is redirected into /shop. Required by policy: every
 * login must re-confirm acceptance, regardless of whether the user
 * accepted previously. The modal is non-dismissible — closing without
 * accepting would leave the parent logged in but not acknowledged.
 *
 * First-time login intentionally does NOT use this modal — its own
 * built-in T&C step already covers the same acceptance.
 */
export function TermsAcceptanceModal({
  open,
  onAccepted,
}: {
  open: boolean;
  /** Called after the server has persisted tc_accepted_at + version. */
  onAccepted: () => void;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setChecks({});
    setSubmitting(false);
    setDone(false);
    setError(undefined);
  }, [open]);

  const allTicked = TC_REQUIRED_CHECKS.every((c) => checks[c.id] === true);

  const accept = async () => {
    if (!allTicked) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await auth.acceptTc(TC_VERSION);
      setDone(true);
      // Small pause so the success state is visible, then hand control
      // back to the parent component for redirect.
      setTimeout(() => onAccepted(), 700);
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : "Could not record acceptance.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {}} // non-dismissible
      title="Terms & Conditions"
      maxWidth="max-w-2xl"
    >
      <div className="p-6 sm:p-8">
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="ok"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-6"
            >
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h3 className="mt-4 font-display text-[20px] font-extrabold text-ink-900">
                Thanks for confirming.
              </h3>
              <p className="mt-1 text-[13px] text-ink-500">Taking you to the shop…</p>
            </motion.div>
          ) : (
            <motion.div
              key="form"
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
                Please confirm you accept the policies below to continue to
                your shop.
              </p>

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
                      checked={checks[c.id] === true}
                      onChange={(e) =>
                        setChecks((m) => ({ ...m, [c.id]: e.target.checked }))
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
                disabled={!allTicked || submitting}
                onClick={accept}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShieldCheck className="h-4 w-4" />
                {submitting ? "Recording…" : "I accept & continue"}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
