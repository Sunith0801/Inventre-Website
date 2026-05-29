"use client";

import { motion } from "framer-motion";
import { Package, Store, Sparkles, ArrowUpRight } from "lucide-react";

const R2 = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images";

export type InnovationsMedia = {
  magicBoxVideo: string;
  qualityImage1: string;
  qualityImage2: string;
};

const DEFAULT_MEDIA: InnovationsMedia = {
  magicBoxVideo: `${R2}/Magic_Box.mp4`,
  qualityImage1: `${R2}/quality1.png`,
  qualityImage2: `${R2}/quality2.png`,
};

export function Innovations({ media }: { media?: Partial<InnovationsMedia> } = {}) {
  const m = { ...DEFAULT_MEDIA, ...(media ?? {}) };
  return (
    <section
      id="innovations"
      className="bg-ink-900 text-white relative overflow-hidden scroll-mt-24"
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 40% at 80% 0%, rgba(228,113,39,0.20) 0%, rgba(228,113,39,0) 60%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 py-16 lg:py-20">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/20 backdrop-blur px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-300" />
              <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-300">
                Innovation
              </span>
            </div>
            <h2 className="mt-4 font-display font-extrabold text-display-md leading-[1.05]">
              Three things that make Inventre{" "}
              <span className="text-brand-300">different.</span>
            </h2>
          </div>
          <a
            href="/experience-store"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/80 hover:text-white transition-colors"
          >
            Visit our Experience Store
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>

        {/* Magic Box — horizontal hero card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 group relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden"
        >
          <div className="grid lg:grid-cols-[1.4fr_1fr]">
            <div className="relative aspect-[16/10] lg:aspect-auto bg-ink-900 overflow-hidden">
              <video preload="metadata"
                autoPlay
                muted
                loop
                playsInline
                className="absolute inset-0 h-full w-full object-cover"
                poster={m.qualityImage1}
              >
                <source
                  src={m.magicBoxVideo}
                  type="video/mp4"
                />
              </video>
              <div className="absolute inset-0 bg-gradient-to-r from-ink-900/40 via-transparent to-ink-900/40" />
              <span className="absolute top-4 left-4 rounded-full bg-brand text-white px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase">
                Signature
              </span>
            </div>
            <div className="p-7 lg:p-9 flex flex-col justify-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 border border-white/20 backdrop-blur text-white">
                <Package className="h-5 w-5" strokeWidth={2} />
              </span>
              <h3 className="mt-5 font-display text-[24px] sm:text-[28px] font-extrabold leading-tight">
                Magic Box
              </h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-white/75 max-w-md">
                Our signature box delivers uniforms and books neatly packed,
                organised, and ready to use. A delightful unboxing experience
                that ensures accuracy, convenience, and care.
              </p>
              <p className="mt-5 inline-flex items-center gap-2 text-[12px] font-semibold tracking-[0.14em] uppercase text-brand-300">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-300" />
                One delivery · zero chase
              </p>
            </div>
          </div>
        </motion.div>

        {/* Trial Store + Experience Store — equal pair below */}
        <div className="mt-5 lg:mt-6 grid md:grid-cols-2 gap-5 lg:gap-6">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
            className="group relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden"
          >
            <div className="grid sm:grid-cols-[1fr_1.1fr]">
              <div className="relative aspect-[4/3] sm:aspect-auto sm:min-h-[200px] bg-ink-900 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.qualityImage1}
                  alt="Trial Store"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-ink-900/40 to-transparent" />
              </div>
              <div className="p-6">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 border border-white/20 backdrop-blur text-white">
                  <Store className="h-4 w-4" strokeWidth={2} />
                </span>
                <h3 className="mt-4 font-display text-[20px] font-extrabold">
                  Trial Store
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/75">
                  An on-campus space where parents and students try, feel, and
                  finalise the perfect fit before ordering.
                </p>
              </div>
            </div>
          </motion.div>

          <motion.a
            href="/experience-store"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="group relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden hover:border-brand-300 transition-colors"
          >
            <div className="grid sm:grid-cols-[1fr_1.1fr]">
              <div className="relative aspect-[4/3] sm:aspect-auto sm:min-h-[200px] bg-ink-900 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.qualityImage2}
                  alt="Experience Store"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-ink-900/40 to-transparent" />
                <span className="absolute top-3 right-3 rounded-full bg-brand text-white px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase">
                  Opening soon
                </span>
              </div>
              <div className="p-6">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 border border-white/20 backdrop-blur text-white">
                  <Sparkles className="h-4 w-4" strokeWidth={2} />
                </span>
                <h3 className="mt-4 font-display text-[20px] font-extrabold flex items-center gap-2">
                  Experience Store
                  <ArrowUpRight className="h-4 w-4 text-brand-300 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/75">
                  Our flagship retail destination at Ashoka Mall, Hyderabad.
                </p>
              </div>
            </div>
          </motion.a>
        </div>
      </div>
    </section>
  );
}
