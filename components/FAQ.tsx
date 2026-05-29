"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";

const FALLBACK = [
  {
    q: "How does sign-in work?",
    a: "Use the mobile number your school has on record. We recognise you instantly, load your child's school, grade, and curated kit — no forms, no school picker.",
  },
  {
    q: "What if my child's size doesn't fit?",
    a: "Free exchanges within 7 days. Order any size, try at home, and we'll swap or refund — pickup is on us.",
  },
];

type Faq = { question: string; answer: string };

export function FAQ({ faqs }: { faqs?: Faq[] }) {
  const list =
    faqs && faqs.length > 0
      ? faqs.map((f) => ({ q: f.question, a: f.answer }))
      : FALLBACK;
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto max-w-4xl px-5 lg:px-8 py-20 lg:py-28">
      <div className="text-center max-w-2xl mx-auto">
        <p className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand">
          Questions, answered
        </p>
        <h2 className="mt-3 font-display font-extrabold text-display-md text-ink-900">
          The things parents and principals actually ask.
        </h2>
      </div>

      <div className="mt-12 divide-y divide-ink-100 border-y border-ink-100">
        {list.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q}>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between gap-6 py-5 text-left"
              >
                <span className="font-display text-[18px] sm:text-[20px] font-semibold text-ink-900">
                  {f.q}
                </span>
                <span
                  className={`grid h-9 w-9 place-items-center rounded-full border border-ink-200 transition-all ${
                    isOpen ? "bg-ink-900 text-white rotate-45 border-ink-900" : "text-ink-700"
                  }`}
                >
                  <Plus className="h-4 w-4" />
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="pb-6 pr-12 text-[15px] leading-relaxed text-ink-600">
                      {f.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
