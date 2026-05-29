"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus } from "lucide-react";
import { useState } from "react";

const faqs = [
  {
    q: "Where's my order?",
    a: "Sign in and head to Orders — every order has a real-time tracker. If something looks off, message us with your order number and we'll dig in.",
  },
  {
    q: "How do returns and exchanges work?",
    a: "Free returns within 7 days. Open Orders → pick the item → choose Return or Exchange. We pick up from your doorstep. Refunds land in 3–5 business days.",
  },
  {
    q: "We're a school — how do partnerships work?",
    a: "We start with a free design consultation. Once your designs are finalised, we onboard your full catalogue and run an on-campus trial store at your school each August. From there, parents order via inventre.in and we deliver in our Magic Box.",
  },
  {
    q: "Do you do bulk / wholesale pricing?",
    a: "Yes — for schools, distributors and manufacturers. Pick the right tab in the form above and tell us volumes; our partnerships team will respond with pricing within 24 hours.",
  },
  {
    q: "Can I visit your store?",
    a: "Yes. Our flagship Experience Store opens this term at Ashoka One Mall, Hyderabad. We also run an on-campus trial store at a partner school every August. See the Experience Store page for details.",
  },
  {
    q: "Is sizing accurate? What if it doesn't fit?",
    a: "Every product page has a detailed size guide. First-time orders are try-before-you-buy — we'll exchange any size for free. After that, exchange windows are 7 days from delivery.",
  },
  {
    q: "Are uniforms made in India?",
    a: "Every Inventre uniform is designed and manufactured in India, to your school's exact spec. Fabrics are sourced from mills we've vetted for durability, comfort and color fastness.",
  },
  {
    q: "Press, media or collaboration?",
    a: "Drop us a line at support@inventre.in with the subject line PRESS — we usually reply within two business days.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-24">
      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-10 lg:gap-16">
        {/* LEFT — heading column */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              Common questions
            </span>
          </div>
          <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
            Maybe we&apos;ve already{" "}
            <span className="text-brand">answered it.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-600 max-w-md">
            If your question is here, you might not need the form at all.
            If not — we&apos;re still one tap away.
          </p>
        </div>

        {/* RIGHT — accordion */}
        <ol className="divide-y divide-ink-100 border-y border-ink-100">
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-start justify-between gap-4 text-left py-5 lg:py-6 group"
                  aria-expanded={isOpen}
                >
                  <div className="flex items-start gap-4 min-w-0">
                    <span className="font-mono text-[12px] font-bold text-brand-300 shrink-0 pt-1.5">
                      /{String(i + 1).padStart(2, "0")}
                    </span>
                    <h3
                      className={
                        "font-display text-[17px] sm:text-[19px] font-bold leading-snug transition-colors " +
                        (isOpen
                          ? "text-brand"
                          : "text-ink-900 group-hover:text-brand-700")
                      }
                    >
                      {f.q}
                    </h3>
                  </div>
                  <span
                    className={
                      "shrink-0 grid h-9 w-9 place-items-center rounded-full transition-all " +
                      (isOpen
                        ? "bg-brand text-white"
                        : "bg-brand-50 border border-brand-100 text-brand group-hover:bg-brand group-hover:text-white")
                    }
                  >
                    {isOpen ? (
                      <Minus className="h-4 w-4" strokeWidth={2.5} />
                    ) : (
                      <Plus className="h-4 w-4" strokeWidth={2.5} />
                    )}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        duration: 0.4,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="overflow-hidden"
                    >
                      <p className="pl-10 pr-12 pb-5 lg:pb-6 text-[14.5px] leading-relaxed text-ink-600 max-w-2xl">
                        {f.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
