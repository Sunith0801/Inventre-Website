"use client";

import { motion } from "framer-motion";
import { Users, School, Building2, ArrowRight, Phone, User } from "lucide-react";

type Door = {
  kind: "parent" | "school" | "business";
  icon: typeof Users;
  label: string;
  helper: string;
  image: string | null; // null = use designed gradient card-top
  phone: string;
};

const R2 = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev";

export type ContactHeroMedia = { parent: string; school: string; business: string };
const DEFAULT_MEDIA: ContactHeroMedia = {
  parent: `${R2}/contact-parent.png`,
  school: `${R2}/images/quality2.png`,
  business: `${R2}/images/All-K-12-essentials.webp`,
};

export function ContactHero({ media }: { media?: Partial<ContactHeroMedia> } = {}) {
  const m = { ...DEFAULT_MEDIA, ...(media ?? {}) };
  const doors: Door[] = [
    { kind: "parent",   icon: Users,      label: "I'm a parent",   helper: "Order, sizing, returns, delivery — quick answers, real humans.",      image: m.parent,   phone: "+91 90599 90804" },
    { kind: "school",   icon: School,     label: "I'm a school",   helper: "Partnership, brand consultation, term-onboarding — design to delivery.", image: m.school,   phone: "+91 90599 90804" },
    { kind: "business", icon: Building2,  label: "I'm a business", helper: "Wholesale, manufacturing, B2B — let's see if we're a fit.",            image: m.business, phone: "+91 90599 90804" },
  ];
  return (
    <section className="relative overflow-hidden">
      {/* Background — cream gradient + dot grid */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-cream-50 via-cream to-cream-200"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(228,113,39,0.18) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-12 md:pt-20 pb-16 md:pb-24">
        {/* Top — short banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="text-center max-w-3xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-70 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              Online now · 24-hr reply
            </span>
          </div>
          <h1
            className="mt-5 font-display font-extrabold text-ink-900"
            style={{
              fontSize: "clamp(2rem, 4.4vw, 4rem)",
              lineHeight: "0.98",
              letterSpacing: "-0.035em",
            }}
          >
            Pick a door.
            <br />
            <span className="text-brand">We&apos;ll meet you there.</span>
          </h1>
          <p className="mt-5 text-[16px] md:text-[17px] leading-relaxed text-ink-600 max-w-xl mx-auto">
            Three different conversations — one team behind all of them.
            Choose what fits.
          </p>
        </motion.div>

        {/* The three doors — orange treatment on hover only */}
        <div className="mt-12 lg:mt-16 grid md:grid-cols-3 gap-4 lg:gap-5">
          {doors.map((d, i) => (
            <motion.div
              key={d.kind}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.7,
                delay: 0.15 + i * 0.1,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="group relative rounded-[24px] overflow-hidden border border-ink-200 bg-white text-ink-900 shadow-[0_20px_40px_-25px_rgba(0,0,0,0.20)] transition-all duration-300 hover:-translate-y-1 hover:border-brand hover:bg-brand hover:text-white hover:shadow-[0_40px_80px_-30px_rgba(228,113,39,0.55)]"
            >
              {/* Top — image strip OR designed gradient (parent) */}
              <div className="relative aspect-[5/3] overflow-hidden bg-gradient-to-br from-brand-50 via-cream-100 to-brand-100">
                {d.image ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={d.image}
                      alt={d.label}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
                    />
                  </>
                ) : (
                  // Designed family-icon composition (parent card)
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="relative flex items-end gap-2 transition-transform duration-700 group-hover:scale-[1.06]">
                      <span className="grid h-16 w-16 sm:h-20 sm:w-20 place-items-center rounded-full bg-white border-2 border-brand-100 text-brand shadow-[0_10px_25px_-10px_rgba(228,113,39,0.30)]">
                        <Users className="h-8 w-8 sm:h-9 sm:w-9" strokeWidth={1.8} />
                      </span>
                      <span className="grid h-12 w-12 sm:h-14 sm:w-14 place-items-center rounded-full bg-brand text-white border-[3px] border-white shadow-[0_8px_20px_-8px_rgba(228,113,39,0.50)]">
                        <User className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2} />
                      </span>
                    </div>
                  </div>
                )}

                {/* Bottom fade — neutral by default, orange wash on hover */}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white transition-opacity duration-300 group-hover:opacity-0" />
                <div className="absolute inset-0 bg-gradient-to-b from-brand/20 via-brand/0 to-brand opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                {/* Icon tile */}
                <span className="absolute top-4 left-4 grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand transition-all duration-300 group-hover:bg-white group-hover:border-white group-hover:text-brand group-hover:shadow-[0_10px_25px_-10px_rgba(0,0,0,0.40)]">
                  <d.icon className="h-5 w-5" strokeWidth={2} />
                </span>

                {/* Index badge */}
                <span className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full backdrop-blur px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase bg-white/90 border border-ink-100 text-ink-900 transition-colors duration-300 group-hover:bg-white/20 group-hover:border-white/30 group-hover:text-white">
                  {String(i + 1).padStart(2, "0")} / 03
                </span>
              </div>

              {/* Bottom — copy */}
              <div className="p-6 lg:p-7">
                <h3 className="font-display text-[22px] sm:text-[26px] font-extrabold leading-tight">
                  {d.label}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600 transition-colors duration-300 group-hover:text-white">
                  {d.helper}
                </p>

                <div className="mt-5 pt-4 border-t border-ink-100 transition-colors duration-300 group-hover:border-white/30 flex items-center justify-between gap-3">
                  <a
                    href={`tel:${d.phone.replace(/\s/g, "")}`}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-700 transition-colors duration-300 group-hover:text-white"
                  >
                    <Phone className="h-3 w-3" />
                    <span className="font-mono">{d.phone}</span>
                  </a>
                  <a
                    href={`#contact-form-${d.kind}`}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand transition-colors duration-300 group-hover:text-white"
                  >
                    Open
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </a>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
