"use client";

import { motion } from "framer-motion";
import { Bell, ArrowRight, Check, Sparkles } from "lucide-react";
import { useState } from "react";

export function NotifyMe() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitted(true);
  };

  return (
    <section
      id="notify"
      className="bg-cream relative overflow-hidden scroll-mt-24"
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-16 lg:py-20">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-[28px] bg-ink-900 text-white overflow-hidden"
        >
          {/* warm radial wash */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(50% 80% at 100% 50%, rgba(228,113,39,0.40) 0%, rgba(228,113,39,0) 65%)",
            }}
          />
          {/* faint grid texture */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          <div className="relative grid lg:grid-cols-[1.4fr_1fr] gap-8 lg:gap-12 p-8 sm:p-10 lg:p-14 items-center">
            {/* LEFT — copy + form */}
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 backdrop-blur px-3 py-1.5">
                <Bell className="h-3.5 w-3.5 text-brand-300" />
                <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-300">
                  Be the first
                </span>
              </span>
              <h2 className="mt-4 font-display font-extrabold text-display-md leading-[1.05]">
                We&apos;ll let you know{" "}
                <span className="text-brand-300">the day we open.</span>
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-white/75 max-w-md">
                Drop your email — one note, no spam. Soft-launch invite and a
                10% off voucher on your first kit.
              </p>

              {submitted ? (
                <div className="mt-7 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-400/30 backdrop-blur px-5 py-3 text-[14px] font-semibold text-emerald-300">
                  <Check className="h-4 w-4" />
                  You&apos;re on the list.
                </div>
              ) : (
                <form
                  onSubmit={onSubmit}
                  className="mt-7 max-w-md flex items-stretch rounded-full border border-white/20 bg-white/10 backdrop-blur overflow-hidden focus-within:border-brand-300 transition-colors"
                >
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourschool.in"
                    className="flex-1 min-w-0 px-5 py-3.5 text-[14px] text-white placeholder:text-white/40 outline-none bg-transparent"
                  />
                  <button
                    type="submit"
                    className="group inline-flex items-center gap-1.5 bg-brand px-5 text-[13px] font-semibold text-white hover:bg-brand-600 transition-colors"
                  >
                    Notify me
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </form>
              )}

              <p className="mt-3 text-[12px] text-white/50">
                Or follow{" "}
                <a
                  href="https://instagram.com/inventre.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-white hover:text-brand-300"
                >
                  @inventre.in
                </a>
                {" "}for sneak peeks.
              </p>
            </div>

            {/* RIGHT — decorative number panel */}
            <div className="relative hidden lg:flex flex-col items-end gap-3">
              <div className="rounded-2xl bg-white/10 border border-white/20 backdrop-blur px-5 py-4 w-full max-w-[260px]">
                <p className="font-display text-[10px] font-bold tracking-[0.18em] uppercase text-brand-300">
                  Voucher inside
                </p>
                <p className="mt-1 font-display text-[32px] font-extrabold leading-none tracking-tight text-white">
                  10%
                </p>
                <p className="mt-1.5 text-[12px] text-white/60">
                  off your first kit
                </p>
              </div>
              <div className="rounded-2xl bg-white/10 border border-white/20 backdrop-blur px-5 py-4 w-full max-w-[260px] flex items-center gap-3">
                <Sparkles className="h-4 w-4 text-brand-300 shrink-0" />
                <div>
                  <p className="font-display text-[12px] font-bold text-white leading-tight">
                    Soft-launch invite
                  </p>
                  <p className="text-[11px] text-white/60 leading-tight mt-0.5">
                    Limited to 200 families
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
