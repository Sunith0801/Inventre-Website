"use client";

import { Camera } from "lucide-react";

const R2 = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images";

export type StoreSneakPeekMedia = {
  image1: string; image2: string; image3: string; image4: string; image5: string;
};
const DEFAULT_MEDIA: StoreSneakPeekMedia = {
  image1: `${R2}/quality1.png`,
  image2: `${R2}/Tshirt(product range).webp`,
  image3: `${R2}/quality2.png`,
  image4: `${R2}/All-K-12-essentials.webp`,
  image5: `${R2}/bags.png`,
};

type TileData = {
  src: string;
  chip: string;
  caption: string;
  rotate: number;
  contain?: boolean;
};

function Tile({
  t,
  index,
}: {
  t: TileData;
  index: number;
}) {
  return (
    <div
      style={{ transform: `rotate(${t.rotate}deg)` }}
      className="shrink-0 w-[260px] sm:w-[300px] lg:w-[320px]"
    >
      <div className="rounded-2xl bg-white p-3 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.25)] border border-ink-100">
        <div
          className={
            "relative aspect-[4/5] rounded-[14px] overflow-hidden " +
            (t.contain
              ? "bg-gradient-to-br from-brand-50 to-cream-100"
              : "bg-ink-900")
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={encodeURI(t.src)}
            alt={t.chip}
            className={
              "absolute inset-0 h-full w-full " +
              (t.contain ? "object-contain p-3" : "object-cover")
            }
          />
          <span className="absolute top-3 left-3 rounded-full bg-white/90 backdrop-blur px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase text-ink-900">
            {t.chip}
          </span>
        </div>
        <div className="mt-3 px-2 pb-1 flex items-center justify-between">
          <p className="font-display text-[13px] font-semibold text-ink-900">
            {t.caption}
          </p>
          <p className="font-mono text-[10px] text-ink-400">
            /{String(index + 1).padStart(2, "0")}
          </p>
        </div>
      </div>
    </div>
  );
}

export function StoreSneakPeek({ media }: { media?: Partial<StoreSneakPeekMedia> } = {}) {
  const m = { ...DEFAULT_MEDIA, ...(media ?? {}) };
  const tiles: TileData[] = [
    { src: m.image1, chip: "Display wall",   caption: "Curated by school",       rotate: -2 },
    { src: m.image2, chip: "Uniform rack",   caption: "Every fabric, every fit", rotate: 1.5, contain: true },
    { src: m.image3, chip: "Fitting corner", caption: "Try before you buy",      rotate: -1 },
    { src: m.image4, chip: "Magic Box wall", caption: "Open one in person",      rotate: 2,   contain: true },
    { src: m.image5, chip: "Bags & shoes",   caption: "Color-matched, ready",    rotate: -1.5, contain: true },
  ];
  return (
    <section className="bg-cream-200 border-y border-ink-100 relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-16 lg:pt-20 pb-10 lg:pb-12">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
            <Camera className="h-3.5 w-3.5 text-brand" />
            <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              Filmstrip · concept
            </span>
          </span>
          <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
            A walk through{" "}
            <span className="text-brand">the floor.</span>
          </h2>
        </div>
      </div>

      {/* Auto-scrolling marquee — no scrollbar, continuous loop */}
      <div className="relative pb-16 lg:pb-20 overflow-hidden">
        {/* Edge fades */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 bottom-0 w-16 lg:w-24 z-10"
          style={{
            background:
              "linear-gradient(to right, rgba(245,240,232,1), rgba(245,240,232,0))",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-16 lg:w-24 z-10"
          style={{
            background:
              "linear-gradient(to left, rgba(245,240,232,1), rgba(245,240,232,0))",
          }}
        />

        <div className="flex gap-6 lg:gap-8 w-max animate-marquee">
          {/* duplicated 2x for seamless loop */}
          {tiles.map((t, i) => (
            <Tile key={`a-${i}`} t={t} index={i} />
          ))}
          {tiles.map((t, i) => (
            <Tile key={`b-${i}`} t={t} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
