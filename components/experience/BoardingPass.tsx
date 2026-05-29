"use client";

import { motion } from "framer-motion";
import { Plane, Phone, MapPin, Clock } from "lucide-react";
// stub fields removed per design — keeping imports lean

export function BoardingPass() {
  return (
    <section className="bg-cream relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-12 lg:py-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative mx-auto max-w-4xl"
        >
          <div className="relative rounded-[24px] bg-white border-2 border-dashed border-ink-200 overflow-hidden shadow-[0_30px_60px_-30px_rgba(0,0,0,0.18)]">
            {/* Top brand bar */}
            <div className="flex items-center justify-between px-6 sm:px-8 py-4 bg-brand text-white">
              <div className="flex items-center gap-2">
                <Plane className="h-3.5 w-3.5 -rotate-45" />
                <p className="font-display text-[10px] font-bold tracking-[0.22em] uppercase">
                  Visitor pass · Inventre
                </p>
              </div>
              <p className="font-mono text-[10px] tracking-wider opacity-80">
                NO. 0001 / SOFT-LAUNCH
              </p>
            </div>

            {/* From / Path / To row */}
            <div className="px-6 sm:px-8 lg:px-10 pt-7 pb-6">
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-semibold tracking-wider uppercase text-ink-400">
                    From
                  </p>
                  <p className="mt-1 font-display text-[24px] sm:text-[32px] font-extrabold leading-none tracking-tight text-ink-900">
                    You
                  </p>
                  <p className="mt-1.5 text-[12px] text-ink-500">
                    Anywhere in India
                  </p>
                </div>

                {/* connector */}
                <div className="flex-1 flex flex-col items-center pb-2 px-2 sm:px-4 max-w-[260px]">
                  <span className="font-mono text-[10px] font-semibold tracking-wider uppercase text-brand-700 mb-1.5">
                    30 min visit
                  </span>
                  <div className="relative w-full h-px">
                    <span
                      aria-hidden
                      className="absolute inset-0"
                      style={{
                        backgroundImage:
                          "linear-gradient(to right, #E47127 50%, transparent 50%)",
                        backgroundSize: "8px 1px",
                        opacity: 0.7,
                      }}
                    />
                    <Plane className="absolute -top-2 left-1/2 -translate-x-1/2 h-4 w-4 text-brand" />
                  </div>
                </div>

                <div className="min-w-0 text-right">
                  <p className="font-mono text-[10px] font-semibold tracking-wider uppercase text-ink-400">
                    To
                  </p>
                  <p className="mt-1 font-display text-[24px] sm:text-[32px] font-extrabold leading-none tracking-tight text-brand">
                    Hyderabad
                  </p>
                  <p className="mt-1.5 text-[12px] text-ink-500 truncate">
                    Ashoka One Mall
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom contact strip */}
            <div className="px-6 sm:px-8 lg:px-10 py-4 border-t-2 border-dashed border-ink-200 flex flex-wrap items-center gap-x-5 gap-y-2 bg-cream-50">
              <a
                href="tel:+917075785732"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-700 hover:text-brand"
              >
                <Phone className="h-3 w-3 text-brand" />
                <span className="font-mono">+91 70757 85732</span>
              </a>
              <span className="hidden sm:inline-block h-3 w-px bg-ink-200" />
              <p className="inline-flex items-center gap-1.5 text-[12px] text-ink-500">
                <MapPin className="h-3 w-3 text-brand" />
                Habeeb Nagar, Kukatpally · Hyderabad 500072
              </p>
              <span className="hidden sm:inline-block h-3 w-px bg-ink-200" />
              <p className="inline-flex items-center gap-1.5 text-[12px] text-ink-500">
                <Clock className="h-3 w-3 text-brand" />
                Mon–Sat · 11–9
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
