"use client";

import { motion } from "framer-motion";
import { ArrowRight, MapPin, Phone } from "lucide-react";

const R2 = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images";
export type ExperienceHeroMedia = { backdrop: string };
const DEFAULT_MEDIA: ExperienceHeroMedia = { backdrop: `${R2}/quality2.png` };

export function ExperienceHero({ media }: { media?: Partial<ExperienceHeroMedia> } = {}) {
  const m = { ...DEFAULT_MEDIA, ...(media ?? {}) };
  return (
    <section className="relative overflow-hidden bg-ink-900">
      {/* Full-bleed background image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={m.backdrop}
        alt="Inventre Experience Store"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Cinematic gradient overlay */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(10,10,10,0.35) 0%, rgba(10,10,10,0.10) 35%, rgba(10,10,10,0.85) 100%)",
        }}
      />
      {/* Side warm wash for brand presence */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(45% 60% at 0% 100%, rgba(228,113,39,0.35) 0%, rgba(228,113,39,0) 60%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 min-h-[78vh] lg:min-h-[82vh] flex flex-col justify-end pt-24 lg:pt-32 pb-12 lg:pb-16">
        {/* Bottom-left copy stack */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-3xl text-white"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-3 py-1.5 shadow-[0_10px_30px_-10px_rgba(228,113,39,0.6)]">
            <span className="font-display text-[11px] font-bold tracking-[0.18em] uppercase">
              Inventre · Hyderabad
            </span>
          </span>
          <h1
            className="mt-5 font-display font-extrabold"
            style={{
              fontSize: "clamp(2.4rem, 5.5vw, 5rem)",
              lineHeight: "0.95",
              letterSpacing: "-0.04em",
            }}
          >
            Touch the fabric.
            <br />
            See the box.
            <br />
            <span className="text-brand">Meet the team.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[16px] md:text-[17px] leading-relaxed text-white/80">
            A flagship destination where every uniform, every size, and the
            full Inventre Magic Box come together — one floor, one feeling.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <a
              href="#address"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-4 text-[14px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-brand-600 active:scale-[0.98] transition-all"
            >
              <MapPin className="h-4 w-4" />
              Find us on the map
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="tel:+917075785732"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 backdrop-blur-md px-6 py-3.5 text-[14px] font-semibold text-white hover:bg-white/15 transition-colors"
            >
              <Phone className="h-4 w-4" />
              Call +91 70757 85732
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
