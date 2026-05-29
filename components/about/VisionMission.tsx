"use client";

import { motion } from "framer-motion";
import { Telescope, Compass } from "lucide-react";

export function VisionMission() {
  return (
    <section className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">
      <div className="text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
            Why we exist
          </span>
        </div>
        <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
          Today we simplify school operations.
          <br />
          <span className="text-brand">Tomorrow, we set the benchmark.</span>
        </h2>
        <p className="mt-5 text-[15px] sm:text-[16px] leading-relaxed text-ink-600">
          With rigorous quality assurance and reliable delivery systems, we
          ensure both schools and parents experience convenience without
          compromise.
        </p>
      </div>

      <div className="mt-14 grid md:grid-cols-2 gap-5 lg:gap-6">
        {/* Vision — light card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="group relative rounded-2xl border border-ink-100 bg-white p-7 lg:p-9 hover:border-brand hover:shadow-[0_20px_40px_-22px_rgba(228,113,39,0.20)] transition-all"
        >
          <div className="flex items-start justify-between">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 border border-brand-100 text-brand transition-all group-hover:bg-brand group-hover:text-white">
              <Telescope className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="font-display text-[44px] font-extrabold leading-none text-brand-50 group-hover:text-brand-100 transition-colors">
              01
            </span>
          </div>
          <p className="mt-6 font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
            Our Vision
          </p>
          <h3 className="mt-2 font-display text-[24px] sm:text-[28px] font-extrabold text-ink-900 leading-tight">
            Operations-free schools.{" "}
            <span className="text-brand">Everywhere.</span>
          </h3>
          <p className="mt-4 text-[14.5px] leading-relaxed text-ink-600">
            The leading tech-enabled platform for every school&apos;s supply
            need — end to end. Our vision is to remove operational chaos so
            educators can focus on what truly matters: teaching and learning.
          </p>

          <div className="mt-6 pt-6 border-t border-ink-100 flex items-baseline gap-2">
            <span className="font-display text-[20px] font-bold text-ink-900">
              2030
            </span>
            <span className="text-[13px] text-ink-500">
              · 1,000+ schools served
            </span>
          </div>
        </motion.div>

        {/* Mission — dark card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-2xl overflow-hidden bg-ink-900 text-white p-7 lg:p-9"
        >
          {/* warm wash */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 60% at 100% 0%, rgba(228,113,39,0.30) 0%, rgba(228,113,39,0) 60%)",
            }}
          />
          <div className="relative">
            <div className="flex items-start justify-between">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 border border-white/20 backdrop-blur text-white">
                <Compass className="h-5 w-5" strokeWidth={2} />
              </span>
              <span className="font-display text-[44px] font-extrabold leading-none text-white/10">
                02
              </span>
            </div>
            <p className="mt-6 font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-300">
              Our Mission
            </p>
            <h3 className="mt-2 font-display text-[24px] sm:text-[28px] font-extrabold leading-tight">
              One trusted partner.{" "}
              <span className="text-brand-300">No chasing.</span>
            </h3>
            <p className="mt-4 text-[14.5px] leading-relaxed text-white/80">
              Bring every school essential into one smart, tech-enabled system.
              Reliable, high-quality, and hassle-free. If a school needs it, we
              make it happen — no chasing, no confusion, just one partner.
            </p>

            <div className="mt-6 pt-6 border-t border-white/10 flex items-baseline gap-2">
              <span className="font-display text-[20px] font-bold text-white">
                Today
              </span>
              <span className="text-[13px] text-white/60">
                · 17+ schools, 20,000+ students
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
