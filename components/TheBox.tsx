"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

const items = [
  { name: "Regular shirt", n: 2 },
  { name: "Trousers / skirt", n: 2 },
  { name: "Sports tee", n: 2 },
  { name: "Sports shorts", n: 2 },
  { name: "Socks (pair)", n: 5 },
  { name: "School bag", n: 1 },
  { name: "Shoes", n: 1 },
  { name: "Water bottle", n: 1 },
  { name: "Winter hoodie", n: 1 },
  { name: "ID lanyard", n: 1 },
];

// Each product starts INSIDE the box (centered, scale 0) and bursts out to its final position
type Flyout = {
  src: string;
  alt: string;
  pos: string; // final absolute position (Tailwind top/left/right/bottom)
  size: string;
  rotate: number;
  delay: number;
  fromX: number; // initial offset toward box center (px)
  fromY: number;
};

const flyouts: Flyout[] = [
  {
    src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Tshirt(product range).webp",
    alt: "Shirt",
    pos: "top-[2%] left-[-4%]",
    size: "w-[30%]",
    rotate: -10,
    delay: 0,
    fromX: 140,
    fromY: 140,
  },
  {
    src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/bags.png",
    alt: "Bag",
    pos: "top-[10%] right-[-4%]",
    size: "w-[28%]",
    rotate: 12,
    delay: 0.08,
    fromX: -150,
    fromY: 130,
  },
  {
    src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/shoes.png",
    alt: "Shoes",
    pos: "bottom-[6%] left-[2%]",
    size: "w-[28%]",
    rotate: -8,
    delay: 0.16,
    fromX: 130,
    fromY: -150,
  },
  {
    src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/socks(product range).webp",
    alt: "Socks",
    pos: "top-[42%] right-[-8%]",
    size: "w-[22%]",
    rotate: 14,
    delay: 0.24,
    fromX: -170,
    fromY: 0,
  },
  {
    src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/bottle(product range).webp",
    alt: "Bottle",
    pos: "bottom-[18%] right-[4%]",
    size: "w-[18%]",
    rotate: 8,
    delay: 0.32,
    fromX: -130,
    fromY: -120,
  },
  {
    src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/WinterHoodie.png",
    alt: "Hoodie",
    pos: "top-[42%] left-[-10%]",
    size: "w-[26%]",
    rotate: -14,
    delay: 0.4,
    fromX: 160,
    fromY: 0,
  },
];

export function TheBox() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const lidY = useTransform(scrollYProgress, [0.15, 0.5], [0, -50]);
  const lidR = useTransform(scrollYProgress, [0.15, 0.5], [0, -22]);

  return (
    <section
      ref={ref}
      className="relative overflow-hidden bg-cream-200 border-y border-ink-100"
      style={{ isolation: "isolate" }}
    >
      {/* very soft warm wash */}
      <div
        aria-hidden
        className="absolute inset-0 -z-0"
        style={{
          background:
            "radial-gradient(55% 45% at 80% 25%, rgba(228,113,39,0.10) 0%, rgba(228,113,39,0) 65%)",
        }}
      />
      {/* subtle dot grid for depth */}
      <div
        aria-hidden
        className="absolute inset-0 -z-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(228,113,39,0.16) 1px, transparent 0)",
          backgroundSize: "26px 26px",
        }}
      />

      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-32 relative">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* LEFT: copy + checklist */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white border border-brand-200 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                The Inventre Box
              </span>
            </div>
            <h2 className="mt-4 font-display font-extrabold text-display-lg text-ink-900">
              Everything for the year.
              <br /> <span className="text-brand">In one box.</span>
            </h2>
            <p className="mt-6 max-w-md text-[16px] leading-relaxed text-ink-700">
              No more racing between vendors. No more uniform-shop queues a
              week before term. Order once, get a single labeled box with every
              item your child needs — branded by your school.
            </p>

            <ul className="mt-8 grid grid-cols-2 gap-x-8 gap-y-2.5">
              {items.map((it, i) => (
                <motion.li
                  key={it.name}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.04 }}
                  className="flex items-baseline justify-between border-b border-brand-200/60 pb-2 text-[14px]"
                >
                  <span className="text-ink-800 font-medium">{it.name}</span>
                  <span className="font-mono text-[12px] font-semibold text-brand">
                    ×{it.n}
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>

          {/* RIGHT: box scene */}
          <div className="relative aspect-square max-w-[540px] mx-auto w-full">
            {/* soft glow under box */}
            <div
              aria-hidden
              className="absolute bottom-[6%] left-1/2 -translate-x-1/2 h-12 w-[65%] rounded-full bg-brand/30 blur-3xl"
            />

            {/* THE BOX — anchor at center */}
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="relative w-[68%] aspect-[5/4]">
                {/* box body */}
                <div className="absolute inset-0 rounded-md bg-gradient-to-b from-[#c45a18] to-[#7a3a0f] shadow-[0_30px_80px_-20px_rgba(122,58,15,0.55)]" />
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-md"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 35%)",
                  }}
                />
                {/* inner darker rectangle (gives depth — looks like box opening) */}
                <div className="absolute inset-x-4 inset-y-6 rounded-sm bg-gradient-to-b from-[#3a1a06] to-[#5a2a0c] shadow-[inset_0_8px_20px_rgba(0,0,0,0.5)]" />
                {/* tape stripe */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 h-full w-[14%] bg-white/8" />
                {/* logo on box */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-display text-[18px] font-extrabold tracking-[0.18em] text-white/85">
                  INVENTRE<span className="text-brand-200">.</span>
                </div>

                {/* lid (top flap) — opens with scroll */}
                <motion.div
                  style={{ y: lidY, rotate: lidR }}
                  className="absolute -top-3 inset-x-0 h-[24%] rounded-md bg-gradient-to-b from-brand to-brand-600 shadow-[0_10px_30px_-5px_rgba(122,58,15,0.45)] origin-bottom-left"
                >
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-1.5 w-20 rounded-full bg-white/30" />
                </motion.div>
              </div>
            </div>

            {/* PRODUCTS — burst from inside the box (centered → outward) */}
            {flyouts.map((p) => (
              <FlyoutItem key={p.alt} item={p} />
            ))}

            {/* floating tag */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.7 }}
              className="absolute top-2 right-0 rounded-full border border-brand-200 bg-white/85 backdrop-blur px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase text-ink-800 shadow-sm"
            >
              Branded · Sealed · Sized
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FlyoutItem({ item }: { item: Flyout }) {
  return (
    <motion.div
      // start: pushed toward box center, tiny, hidden (inside the box)
      initial={{
        opacity: 0,
        scale: 0.15,
        x: item.fromX,
        y: item.fromY,
        rotate: 0,
      }}
      whileInView={{
        opacity: 1,
        scale: 1,
        x: 0,
        y: 0,
        rotate: item.rotate,
      }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{
        duration: 1.1,
        delay: 0.4 + item.delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      // blend-mode at the motion.div level: the entire animated wrapper blends with
      // the section bg as one layer, dodging the stacking-context issue that breaks
      // blend modes inside transformed parents.
      style={{ mixBlendMode: "multiply" }}
      className={`absolute ${item.pos} ${item.size}`}
    >
      <div className="relative aspect-square">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={encodeURI(item.src)}
          alt={item.alt}
          loading="lazy"
          className="relative h-full w-full object-contain"
        />
      </div>
    </motion.div>
  );
}
