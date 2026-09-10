"use client";

import { motion } from "framer-motion";
import { Quote } from "lucide-react";

const FALLBACK = [
  {
    img: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/testimonial_1.jpg",
    name: "Mrs. Aparna Menon",
    role: "Principal",
    school: "Indus International School",
    short: "INDUS INTL",
    quote:
      "Our parents stopped chasing five vendors before every term. One labeled box arrives, sorted by class.",
  },
  {
    img: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Chitra Sharma_testimonial.jpg",
    name: "Mrs. Chitra Sharma",
    role: "Principal",
    school: "Yellow Train International School",
    short: "YELLOW TRAIN",
    quote:
      "Fabrics held up through monsoon, sports and a full academic year. Stitching is institutional grade.",
  },
  {
    img: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/testimonial_2.jpg",
    name: "Mrs. Sushma K.",
    role: "Principal",
    school: "Winmore Academy",
    short: "WINMORE",
    quote: "They treat our crest like their own. Color-matched, consistent across 800 kids.",
  },
];

type T = {
  name: string;
  role: string;
  school: string;
  shortLabel: string;
  quote: string;
  photoUrl: string | null;
};

export function PrincipalsHero({ testimonials }: { testimonials?: T[] }) {
  const principals =
    testimonials && testimonials.length > 0
      ? testimonials.map((t) => ({
          img: t.photoUrl ?? "",
          name: t.name,
          role: t.role,
          school: t.school,
          short: t.shortLabel,
          quote: t.quote,
        }))
      : FALLBACK;
  return (
    <section className="relative overflow-hidden bg-cream">
      {/* warm bg wash */}
      <div
        aria-hidden
        className="absolute inset-0 -z-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(228,113,39,0.10) 0%, rgba(228,113,39,0) 60%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              The schools we serve
            </span>
          </div>
          <h2 className="mt-4 font-display font-extrabold text-display-md text-brand leading-[1.05]">
            The schools we serve speak for us.
          </h2>
          <p className="mt-5 text-[15px] sm:text-[16px] leading-relaxed text-ink-600 max-w-2xl mx-auto">
            Three principals. Three different schools. One shared verdict.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {principals.map((p, i) => (
            <motion.figure
              key={`${p.school || "school"}-${i}`}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{
                duration: 0.7,
                delay: i * 0.12,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="group flex flex-col"
            >
              <div className="relative aspect-[3/4] overflow-hidden rounded-3xl bg-cream-200 border border-ink-200">
                {/* portrait */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={encodeURI(p.img)}
                  alt={p.name}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.04]"
                />
                {/* gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900/85 via-ink-900/10 to-transparent" />

                {/* school chip */}
                <span className="absolute top-4 left-4 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-[10px] font-bold tracking-[0.14em] uppercase text-ink-900">
                  {p.short}
                </span>

                {/* quote at bottom */}
                <figcaption className="absolute bottom-0 inset-x-0 p-5 sm:p-6 text-white">
                  <Quote className="h-5 w-5 text-brand-300 mb-3" />
                  <blockquote className="text-[14px] sm:text-[15px] leading-relaxed font-medium">
                    &quot;{p.quote}&quot;
                  </blockquote>
                </figcaption>
              </div>
              <div className="mt-5 flex items-center gap-4">
                <span className="font-display text-[40px] font-extrabold leading-none text-brand-200 group-hover:text-brand transition-colors shrink-0">
                  0{i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-display text-[18px] font-bold text-ink-900 truncate">
                    {p.name}
                  </p>
                  <p className="text-[13px] text-ink-500 truncate">
                    {p.role} · {p.school}
                  </p>
                </div>
              </div>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
