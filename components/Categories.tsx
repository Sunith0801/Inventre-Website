"use client";

import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

const cats = [
  {
    name: "Regular Uniforms",
    count: "12 styles",
    img: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/REGULAR UNIFORM.png",
    bg: "from-[#FFE9D4] to-[#FCD5B0]",
  },
  {
    name: "Sports Uniforms",
    count: "8 styles",
    img: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Sports uniform.png",
    bg: "from-[#FFF1E0] to-[#FFE0BF]",
  },
  {
    name: "Accessories",
    count: "16 items",
    img: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/ACCESSORIES.png",
    bg: "from-[#FFEAD3] to-[#FBD3A5]",
  },
  {
    name: "Essentials",
    count: "20+ items",
    img: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/ESSENTIALS.png",
    bg: "from-[#FFF3E5] to-[#FFE2C2]",
  },
];

export function Categories() {
  return (
    <section id="shop" className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">
      <div className="flex items-end justify-between gap-6 mb-12">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              Shop the kit
            </span>
          </div>
          <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 max-w-2xl">
            Every essential, expert-designed and{" "}
            <span className="text-brand">rigorously tested.</span>
          </h2>
        </div>
        <a
          href="#"
          className="hidden md:inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-700 hover:text-brand transition-colors"
        >
          View all <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
        {cats.map((c, i) => (
          <motion.a
            key={c.name}
            href="#"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            className="group relative aspect-[4/5] overflow-hidden rounded-2xl border border-ink-200 bg-cream-100 hover:border-brand transition-colors"
          >
            {/* warm gradient bg */}
            <div
              className={`absolute inset-0 bg-gradient-to-br ${c.bg} transition-transform duration-700 ease-out-expo group-hover:scale-105`}
            />
            {/* product image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={encodeURI(c.img)}
              alt={c.name}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-contain p-6 transition-transform duration-700 ease-out-expo group-hover:scale-110"
            />
            {/* top-left badge */}
            <span className="absolute top-4 left-4 rounded-full bg-white/85 backdrop-blur border border-white px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase text-ink-800">
              {c.count}
            </span>
            {/* bottom info bar */}
            <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-white via-white/90 to-transparent">
              <div className="flex items-end justify-between">
                <h3 className="font-display text-[20px] sm:text-[22px] font-bold leading-tight text-ink-900">
                  {c.name}
                </h3>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-white transition-all group-hover:bg-brand group-hover:rotate-45">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </div>
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
