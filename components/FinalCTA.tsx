"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export function FinalCTA() {
  return (
    <section id="find" className="mx-auto max-w-7xl px-5 lg:px-8 pb-20 lg:pb-28">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6 }}
        className="relative overflow-hidden rounded-[28px] bg-ink-900 text-white p-8 sm:p-12 lg:p-20"
      >
        {/* decorative grid */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        {/* glow */}
        <div
          aria-hidden
          className="absolute -top-32 -right-32 h-[400px] w-[400px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(228,113,39,0.35), rgba(228,113,39,0) 70%)",
          }}
        />

        <div className="relative grid lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-7">
            <p className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-300">
              Ready when you are
            </p>
            <h2 className="mt-3 font-display font-extrabold text-display-lg leading-[1.02]">
              One box.
              <br />
              One click. <span className="text-brand">Done.</span>
            </h2>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-200">
              Sign in with your registered mobile. We&apos;ll load your child&apos;s
              kit, you tap checkout, and it&apos;s at your door before term begins.
            </p>
          </div>

          <div className="lg:col-span-5 flex flex-col sm:flex-row gap-3">
            <a
              href="/login"
              className="group flex-1 inline-flex items-center justify-between gap-2 rounded-full bg-brand px-6 py-4 text-[15px] font-semibold text-white hover:bg-brand-600 transition-colors"
            >
              Sign in to shop
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="mailto:support@inventre.in?subject=Partner%20with%20Inventre"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 backdrop-blur px-6 py-4 text-[15px] font-semibold text-white hover:bg-white/10 transition-colors"
            >
              Partner with us
            </a>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
