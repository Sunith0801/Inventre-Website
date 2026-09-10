"use client";

import { motion } from "framer-motion";
import { Quote } from "lucide-react";

const items = [
  {
    quote:
      "Our parents stopped chasing five vendors before every term. One labeled box arrives, sorted by class. The relief is real.",
    name: "Dr. Aparna Menon",
    role: "Principal",
    school: "Indus International School",
    angle: "Parent experience",
  },
  {
    quote:
      "The fabrics held up through monsoon, sports, and a full academic year. Stitching is institutional grade — not retail.",
    name: "Vivek R.",
    role: "Principal",
    school: "Yellow Train International School",
    angle: "Build quality",
  },
  {
    quote:
      "They treat our crest like their own. Color-matched, embroidered, consistent across 800 kids. That's brand work.",
    name: "Sushma K.",
    role: "Principal",
    school: "Winmore Academy",
    angle: "Brand consistency",
  },
];

export function Testimonials() {
  return (
    <section className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">
      <div className="max-w-2xl">
        <p className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand">
          Words from principals
        </p>
        <h2 className="mt-3 font-display font-extrabold text-display-md text-ink-900">
          The people who decide, recommend us.
        </h2>
      </div>

      <div className="mt-12 grid md:grid-cols-3 gap-5 lg:gap-6">
        {items.map((t, i) => (
          <motion.figure
            key={t.school}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="relative rounded-2xl border border-ink-200 bg-white p-7 flex flex-col"
          >
            <Quote className="absolute top-6 right-6 h-5 w-5 text-brand-200" />
            <span className="self-start rounded-full border border-ink-200 px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase text-ink-500">
              {t.angle}
            </span>
            <blockquote className="mt-5 text-[15px] leading-relaxed text-ink-800 flex-1">
              &quot;{t.quote}&quot;
            </blockquote>
            <figcaption className="mt-6 pt-5 border-t border-ink-100 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-brand-200 to-brand-400 grid place-items-center font-display text-[14px] font-bold text-white">
                {t.name
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div>
                <p className="text-[14px] font-semibold text-ink-900">{t.name}</p>
                <p className="text-[12px] text-ink-500">
                  {t.role} · {t.school}
                </p>
              </div>
            </figcaption>
          </motion.figure>
        ))}
      </div>
    </section>
  );
}
