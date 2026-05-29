"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

export function ReviewForm({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRating(0);
    setHoverRating(0);
    setBody("");
    setSubmitted(false);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (rating === 0) {
      setError("Pick a rating");
      return;
    }
    if (body.length < 10) {
      setError("Tell us a bit more (min 10 chars)");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, rating, body }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not submit review");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand text-white px-4 h-9 text-[12px] font-bold hover:bg-brand-600 transition-colors"
      >
        <Star className="h-3.5 w-3.5 fill-white" /> Write a review
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Write a review">
        <div className="p-6 sm:p-8">
          <AnimatePresence mode="wait">
            {submitted ? (
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
                  Review submitted
                </h3>
                <p className="mt-2 text-[14px] text-ink-600 max-w-xs mx-auto">
                  Our team will moderate it within 24 hours. Thanks for the
                  feedback.
                </p>
                <button
                  onClick={() => setOpen(false)}
                  className="mt-6 inline-flex items-center justify-center rounded-full bg-ink-900 text-white h-11 px-6 text-[13px] font-semibold hover:bg-brand transition-colors"
                >
                  Done
                </button>
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
                  Your review
                </p>
                <h3 className="mt-2 font-display text-[24px] font-extrabold text-ink-900">
                  How was it?
                </h3>

                <div className="mt-5">
                  <span className="text-[12px] font-semibold text-ink-700">
                    Rating
                  </span>
                  <div className="mt-2 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const filled = (hoverRating || rating) >= n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onMouseEnter={() => setHoverRating(n)}
                          onMouseLeave={() => setHoverRating(0)}
                          onClick={() => setRating(n)}
                          aria-label={`${n} star`}
                          className="grid h-9 w-9 place-items-center rounded-md hover:bg-cream-100 transition-colors"
                        >
                          <Star
                            className={
                              "h-5 w-5 transition-colors " +
                              (filled
                                ? "text-brand fill-brand"
                                : "text-ink-300")
                            }
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="mt-5 flex flex-col">
                  <span className="text-[12px] font-semibold text-ink-700">
                    Tell us more
                  </span>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={4}
                    placeholder="Quality, fit, durability — anything that helps another parent."
                    className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900 resize-none"
                    maxLength={2000}
                  />
                  <span className="mt-1 text-[11px] text-ink-400">
                    {body.length}/2000
                  </span>
                </label>

                {error && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white h-12 px-6 text-[14px] font-bold hover:bg-brand-600 disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Submit review"}
                </button>
                <p className="mt-3 text-[11px] text-ink-500 text-center">
                  Reviews are moderated before they appear publicly.
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </Modal>
    </>
  );
}
