"use client";

import { motion } from "framer-motion";
import { ArrowRight, Quote, MapPin } from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: i * 0.08 },
  }),
};

const R2 = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images";
export type AboutHeroMedia = { image1: string; image2: string };
const DEFAULT_MEDIA: AboutHeroMedia = {
  image1: `${R2}/quality1.png`,
  image2: `${R2}/quality2.png`,
};

export function AboutHero({ media }: { media?: Partial<AboutHeroMedia> } = {}) {
  const m = { ...DEFAULT_MEDIA, ...(media ?? {}) };
  return (
    <section className="relative overflow-hidden">
      {/* Cream gradient base */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-cream-50 via-cream to-cream-200"
      />
      {/* Quiet orange dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(228,113,39,0.18) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-12 md:pt-20 pb-16 md:pb-20">
        {/* TOP — manifesto, full width, centered max-w-4xl */}
        <div className="max-w-4xl">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={0}
            className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              About Inventre
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={1}
            className="mt-5 font-display font-extrabold text-ink-900"
            style={{
              fontSize: "clamp(2rem, 4.6vw, 4.2rem)",
              lineHeight: "1.0",
              letterSpacing: "-0.035em",
            }}
          >
            Began with a <span className="text-brand">simple idea.</span>
            <br />
            Schools deserve better.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={2}
            className="mt-6 max-w-2xl text-[16px] md:text-[17px] leading-relaxed text-ink-600"
          >
            Schools shouldn&apos;t have to chase vendors for essentials.
            Uniforms, supplies, books — what should be effortless was becoming
            a logistical mess. So we built a smarter system.
          </motion.p>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={3}
            className="mt-8 flex flex-col sm:flex-row gap-3"
          >
            <a
              href="/contact?topic=partnership"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-4 text-[14px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-brand-600 active:scale-[0.98] transition-all"
            >
              Partner with us
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="#process"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-ink-900 px-6 py-3.5 text-[14px] font-semibold text-cream hover:bg-ink-700 transition-colors"
            >
              See how we deliver
            </a>
          </motion.div>
        </div>

        {/* MOSAIC — 1 big photo + 4 small tiles, two rows */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={4}
          className="mt-12 lg:mt-16 grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 auto-rows-[130px] sm:auto-rows-[150px] lg:auto-rows-[170px]"
        >
          {/* BIG photo — 2 cols × 2 rows */}
          <div className="relative col-span-2 row-span-2 overflow-hidden rounded-2xl border border-ink-200 bg-ink-900 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.30)] group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.image1}
              alt="Inventre — students"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900/85 via-ink-900/10 to-transparent" />
            <span className="absolute top-4 left-4 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-[10px] font-bold tracking-[0.14em] uppercase text-ink-900">
              Real schools · real kids
            </span>
            <div className="absolute bottom-5 left-5 right-5 text-white">
              <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase opacity-80">
                Why we exist
              </p>
              <p className="mt-1 font-display text-[20px] sm:text-[24px] font-extrabold leading-tight">
                Translating a school&apos;s ethos into things kids are proud
                to carry.
              </p>
            </div>
          </div>

          {/* Trust tile — what the platform actually delivers, more
              relevant to a parent visiting the About page than the
              parent company's backstory. */}
          <div className="relative overflow-hidden rounded-2xl border border-ink-100 bg-white p-5 flex flex-col justify-between">
            <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              Trusted by
            </p>
            <div>
              <p className="font-display text-[22px] font-extrabold text-ink-900 leading-tight">
                17+ schools
              </p>
              <p className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-ink-500">
                <MapPin className="h-3 w-3" strokeWidth={2.2} />
                Across India · 20,000+ families
              </p>
            </div>
          </div>

          {/* K-12 stat tile */}
          <div className="relative overflow-hidden rounded-2xl border border-brand-100 bg-brand-50 p-5 flex flex-col justify-between">
            <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              End to end
            </p>
            <div>
              <p className="font-display text-[36px] sm:text-[42px] font-extrabold leading-none tracking-tight text-brand">
                K–12
              </p>
              <p className="mt-2 text-[11px] text-ink-600 leading-tight">
                uniforms · books · essentials
              </p>
            </div>
          </div>

          {/* Secondary photo */}
          <div className="relative overflow-hidden rounded-2xl border border-ink-200 bg-ink-900 group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.image2}
              alt="Inventre — uniforms"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900/70 via-transparent to-transparent" />
            <span className="absolute top-3 left-3 rounded-full bg-white/90 backdrop-blur px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase text-ink-900">
              Crafted
            </span>
          </div>

          {/* Quote tile */}
          <div className="relative overflow-hidden rounded-2xl border border-ink-900 bg-ink-900 text-white p-5 flex flex-col">
            <Quote className="h-5 w-5 text-brand-300 mb-2" />
            <blockquote className="font-display text-[14px] sm:text-[15px] font-bold leading-snug">
              &ldquo;One trusted partner. No chasing.&rdquo;
            </blockquote>
            <p className="mt-auto pt-3 text-[10px] font-semibold tracking-[0.14em] uppercase text-brand-300">
              The Inventre promise
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
