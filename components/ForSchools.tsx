"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";

const benefits = [
  "Brand consistency across every uniform and accessory",
  "Zero parent-vendor coordination — we handle every order",
  "Custom insignia, ties, blazers and sports kits",
  "Dedicated school portal with order tracking and analytics",
  "Free returns and size exchanges, on us",
  "Single-point logistics: one box per child, on time",
];

const R2 = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images";
export type ForSchoolsMedia = { magicBoxVideo: string };
const DEFAULT_MEDIA: ForSchoolsMedia = { magicBoxVideo: `${R2}/Magic_Box.mp4` };

export function ForSchools({ media }: { media?: Partial<ForSchoolsMedia> } = {}) {
  const m = { ...DEFAULT_MEDIA, ...(media ?? {}) };
  return (
    <section
      id="schools"
      className="relative bg-cream-200 border-y border-ink-100"
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
          >
            <p className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand">
              For Schools
            </p>
            <h2 className="mt-3 font-display font-extrabold text-display-md text-ink-900">
              Your school&apos;s brand, delivered.
            </h2>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-600">
              We become your invisible uniform partner — your brand, your
              standards, our logistics. Principals get oversight. Parents get
              convenience. Kids get their kit.
            </p>

            <ul className="mt-8 space-y-3">
              {benefits.map((b, i) => (
                <motion.li
                  key={b}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                  className="flex items-start gap-3 text-[14px] text-ink-700"
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {b}
                </motion.li>
              ))}
            </ul>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a
                href="mailto:support@inventre.in?subject=Partner%20with%20Inventre"
                className="group inline-flex items-center gap-2 rounded-full bg-ink-900 px-6 py-3.5 text-[14px] font-semibold text-cream hover:bg-ink-700 transition-colors"
              >
                Partner with us
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <a
                href="mailto:support@inventre.in?subject=Partner%20deck"
                className="text-[14px] font-medium text-ink-700 hover:text-ink-900 underline underline-offset-4"
              >
                Request partner deck
              </a>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative"
          >
            <div className="relative aspect-[4/5] rounded-2xl overflow-hidden border border-ink-200 bg-ink-900">
              <video preload="metadata"
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                loop
                playsInline
              >
                <source src={m.magicBoxVideo} type="video/mp4" />
              </video>
              <div className="absolute inset-0 bg-gradient-to-t from-ink-900/85 via-ink-900/10 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-6 text-white">
                <p className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase opacity-70">
                  The magic box
                </p>
                <p className="mt-2 font-display text-[24px] font-bold leading-tight">
                  Every child&apos;s kit, packed and labeled by name.
                </p>
              </div>
            </div>

            {/* stat tile */}
            <div className="absolute -bottom-6 -left-4 sm:-left-8 rounded-2xl border border-ink-200 bg-cream p-5 shadow-[0_15px_40px_-15px_rgba(0,0,0,0.18)]">
              <p className="font-display text-[44px] font-extrabold leading-none text-ink-900">
                98%
              </p>
              <p className="mt-1 text-[12px] text-ink-600 max-w-[160px] leading-snug">
                of partner schools renew with Inventre year over year
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
