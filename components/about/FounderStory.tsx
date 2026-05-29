"use client";

import { motion } from "framer-motion";
import { Quote } from "lucide-react";

const R2 = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images";
export type FounderStoryMedia = { video1: string; video2: string };
const DEFAULT_MEDIA: FounderStoryMedia = {
  video1: `${R2}/slider_3.mp4`,
  video2: `${R2}/slider_2.mp4`,
};

export function FounderStory({ media }: { media?: Partial<FounderStoryMedia> } = {}) {
  const m = { ...DEFAULT_MEDIA, ...(media ?? {}) };
  return (
    <section className="bg-cream-200 border-y border-ink-100 relative overflow-hidden">
      {/* quiet orange dot grid */}
      <div
        aria-hidden
        className="absolute inset-0 -z-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(228,113,39,0.18) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-10 lg:gap-16 items-center">
          {/* Left: ambient video + overlap stat */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-ink-200 bg-ink-900 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.35)]">
              <video preload="metadata"
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                poster="https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/quality1.png"
              >
                <source
                  src={m.video1}
                  type="video/mp4"
                />
                <source
                  src={m.video2}
                  type="video/mp4"
                />
              </video>
              <div className="absolute inset-0 bg-gradient-to-t from-ink-900/70 via-ink-900/0 to-ink-900/20" />
              <span className="absolute top-4 left-4 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-[10px] font-bold tracking-[0.14em] uppercase text-ink-900">
                Made in India
              </span>
            </div>

            {/* overlap card with stat */}
            <div className="absolute -bottom-6 -right-4 sm:-right-6 w-[58%] rounded-2xl border border-ink-200 bg-white p-5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.18)]">
              <p className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase text-brand">
                Founded
              </p>
              <p className="mt-1 font-display text-[44px] font-extrabold leading-none tracking-tight text-ink-900">
                2022
              </p>
              <p className="mt-2 text-[13px] text-ink-500">
                Hyderabad · across India
              </p>
            </div>
          </motion.div>

          {/* Right: story */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                Our story
              </span>
            </div>
            <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
              We watched parents juggle five vendors.{" "}
              <span className="text-brand">So we replaced them with one.</span>
            </h2>

            <motion.figure
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mt-8 relative rounded-2xl border border-ink-100 bg-white p-6 lg:p-7"
            >
              <Quote className="absolute -top-3 -left-3 h-7 w-7 text-brand-200 bg-cream-200 rounded-full p-1" />
              <blockquote className="font-display text-[18px] sm:text-[20px] font-bold leading-snug text-ink-900">
                &ldquo;Uniforms, books, supplies — every August it turned into a
                logistical nightmare. We knew there was a smarter way.&rdquo;
              </blockquote>
              <figcaption className="mt-4 text-[13px] text-ink-500">
                — The Inventre team, on why we started
              </figcaption>
            </motion.figure>

            <p className="mt-6 text-[15px] leading-relaxed text-ink-600 max-w-xl">
              Inventre is a tech-enabled, service-driven partner offering one
              seamless solution for everything a school needs — from K–12
              uniforms and learning kits to accessories and admin supplies.
              From design consultation to doorstep delivery, we manage every
              step with precision, care, and zero stress.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
