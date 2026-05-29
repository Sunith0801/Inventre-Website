"use client";

import { motion } from "framer-motion";
import { MapPin } from "lucide-react";

// Pseudo-random distribution for trial-store dots — fixed seed
const dots = [
  { x: 15, y: 25 }, { x: 35, y: 18 }, { x: 55, y: 30 }, { x: 75, y: 22 },
  { x: 22, y: 45 }, { x: 45, y: 50 }, { x: 65, y: 42 }, { x: 80, y: 55 },
  { x: 18, y: 65 }, { x: 38, y: 72 }, { x: 58, y: 68 }, { x: 78, y: 78 },
  { x: 28, y: 82 }, { x: 48, y: 35 }, { x: 68, y: 85 }, { x: 12, y: 38 },
  { x: 32, y: 60 }, { x: 52, y: 80 }, { x: 72, y: 50 }, { x: 88, y: 30 },
  { x: 8, y: 52 }, { x: 25, y: 12 }, { x: 42, y: 88 }, { x: 62, y: 12 },
  { x: 82, y: 68 }, { x: 92, y: 45 }, { x: 5, y: 75 }, { x: 50, y: 25 },
  { x: 70, y: 75 }, { x: 30, y: 38 }, { x: 60, y: 58 }, { x: 85, y: 88 },
  { x: 15, y: 88 }, { x: 40, y: 28 }, { x: 65, y: 90 }, { x: 90, y: 12 },
  { x: 25, y: 92 }, { x: 50, y: 95 }, { x: 75, y: 8 }, { x: 95, y: 65 },
];

export function TrialStoreOrigin() {
  return (
    <section className="bg-cream-200 border-y border-ink-100 relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-16 lg:py-20">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              The origin
            </span>
          </div>
          <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
            One <span className="text-brand">trial store.</span>{" "}
            <br className="hidden sm:block" />
            One flagship Experience Store.
          </h2>
          <p className="mt-4 text-[15px] sm:text-[16px] leading-relaxed text-ink-600">
            Every August, Inventre runs an on-campus trial store so parents
            can try uniforms before ordering. The Experience Store is where
            it all converges, year-round.
          </p>
        </div>

        {/* Comparison split — no photos, only data viz */}
        <div className="mt-12 grid sm:grid-cols-[1fr_auto_1fr] gap-6 sm:gap-4 items-stretch">
          {/* LEFT — 40+ trial store dots */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative rounded-2xl border border-ink-100 bg-white p-6 lg:p-8"
          >
            <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase text-ink-400">
              Today
            </p>
            <p className="mt-1 font-display text-[44px] sm:text-[52px] font-extrabold leading-none tracking-tight text-ink-900">
              1
            </p>
            <p className="mt-1.5 text-[13px] text-ink-500">
              Trial store · on partner campus
            </p>

            {/* Scattered dots */}
            <div className="mt-5 relative aspect-[5/3] rounded-xl bg-cream-100 border border-ink-100 overflow-hidden">
              {dots.map((d, i) => (
                <motion.span
                  key={i}
                  initial={{ scale: 0, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.015 }}
                  className="absolute h-3 w-3 rounded-full bg-brand"
                  style={{
                    left: `${d.x}%`,
                    top: `${d.y}%`,
                    transform: "translate(-50%, -50%)",
                    boxShadow:
                      "0 0 0 4px rgba(228,113,39,0.20), 0 6px 12px -3px rgba(228,113,39,0.35)",
                  }}
                />
              ))}
            </div>
            <p className="mt-3 text-[11px] text-ink-500 italic">
              Each dot = one school we serve every August.
            </p>
          </motion.div>

          {/* MIDDLE — connector arrow */}
          <div className="hidden sm:flex flex-col items-center justify-center">
            <div className="relative h-12 w-px bg-transparent">
              <span
                className="block h-full w-px"
                style={{
                  backgroundImage:
                    "linear-gradient(to bottom, #E47127 50%, transparent 50%)",
                  backgroundSize: "1px 6px",
                }}
              />
            </div>
            <span className="my-2 font-display text-[10px] font-bold tracking-[0.22em] uppercase text-brand-700">
              becomes
            </span>
            <div
              className="h-12 w-px"
              style={{
                backgroundImage:
                  "linear-gradient(to bottom, #E47127 50%, transparent 50%)",
                backgroundSize: "1px 6px",
              }}
            />
          </div>

          {/* RIGHT — single big flagship pin */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="relative rounded-2xl border border-brand bg-brand text-white p-6 lg:p-8 shadow-[0_30px_60px_-30px_rgba(228,113,39,0.6)]"
          >
            {/* warm wash */}
            <div
              aria-hidden
              className="absolute inset-0 rounded-2xl"
              style={{
                background:
                  "radial-gradient(60% 60% at 50% 0%, rgba(255,255,255,0.20), rgba(255,255,255,0) 60%)",
              }}
            />
            <div className="relative">
              <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase text-white/80">
                Soon
              </p>
              <p className="mt-1 font-display text-[44px] sm:text-[52px] font-extrabold leading-none tracking-tight">
                1
              </p>
              <p className="mt-1.5 text-[13px] text-white/90">
                Flagship Experience Store
              </p>

              <div className="mt-5 relative aspect-[5/3] rounded-xl bg-white/10 border border-white/20 overflow-hidden grid place-items-center">
                <span className="relative grid place-items-center">
                  <span className="absolute h-16 w-16 rounded-full bg-white/15 animate-ping" />
                  <span className="relative grid h-12 w-12 place-items-center rounded-full bg-white text-brand">
                    <MapPin className="h-5 w-5" strokeWidth={2.5} />
                  </span>
                </span>
              </div>
              <p className="mt-3 text-[11px] text-white/85 italic">
                Ashoka One Mall, Hyderabad · 3rd floor
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
