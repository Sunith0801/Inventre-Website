"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Volume2, VolumeX, Play } from "lucide-react";

export type Clip = {
  src: string;
  poster?: string;
  caption: string;
  meta: string;
};

const DEFAULT_CLIPS: Clip[] = [
  {
    src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/slider_1.mp4",
    poster:
      "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1400&q=80",
    caption: "Crafting your school's brand story",
    meta: "Indus International · Term opening",
  },
  {
    src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/slider_2.mp4",
    poster:
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1000&q=80",
    caption: "Inspiring young minds",
    meta: "Yellow Train · Sports day",
  },
  {
    src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/slider_3.mp4",
    poster:
      "https://images.unsplash.com/photo-1588072432836-e10032774350?auto=format&fit=crop&w=1000&q=80",
    caption: "Building future leaders",
    meta: "Winmore Academy · Annual day",
  },
];

function VideoCard({
  clip,
  className = "",
  large = false,
}: {
  clip: Clip;
  className?: string;
  large?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  const toggleMute = () => {
    if (!ref.current) return;
    ref.current.muted = !ref.current.muted;
    setMuted(ref.current.muted);
  };

  return (
    <motion.figure
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`group relative overflow-hidden rounded-2xl border border-ink-200 bg-ink-900 ${className}`}
    >
      <video preload="metadata"
        ref={ref}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.03]"
        autoPlay
        muted
        loop
        playsInline
        poster={clip.poster}
      >
        <source src={clip.src} type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-gradient-to-t from-ink-900/90 via-ink-900/15 to-transparent" />

      {/* corner brand chip */}
      <span className="absolute top-4 left-4 rounded-full bg-brand text-white px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase">
        Live · Real
      </span>

      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 backdrop-blur border border-white/25 text-white opacity-80 group-hover:opacity-100 transition-opacity hover:bg-white/20"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>

      <figcaption className="absolute bottom-0 inset-x-0 p-5 sm:p-6 text-white">
        <p className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase opacity-80">
          {clip.meta}
        </p>
        <p
          className={`mt-1.5 font-display font-bold leading-tight ${
            large ? "text-[26px] sm:text-[32px] lg:text-[40px]" : "text-[18px] sm:text-[20px]"
          }`}
        >
          {clip.caption}
        </p>
      </figcaption>
    </motion.figure>
  );
}

export function InTheWild({
  heading,
  sub,
  clips,
}: {
  heading?: string;
  sub?: string;
  clips?: Clip[];
} = {}) {
  const data = clips && clips.length >= 3 ? clips : DEFAULT_CLIPS;
  return (
    <section className="mx-auto max-w-7xl px-5 lg:px-8 py-20 lg:py-28">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
            <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
              Inventre, in the wild
            </span>
          </div>
          <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900">
            {heading ?? (
              <>
                Real schools. Real kids.{" "}
                <span className="text-brand">Real first-day pride.</span>
              </>
            )}
          </h2>
        </div>
        <p className="max-w-sm text-[14px] text-ink-600 md:pb-2">
          {sub ?? "Captured at our partner schools across India. Tap the speaker to unmute."}
        </p>
      </div>

      {/* mosaic grid: 1 large left + 2 stacked right (desktop) — single column (mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5 lg:auto-rows-[260px]">
        <VideoCard
          clip={data[0]}
          large
          className="lg:col-span-2 lg:row-span-2 aspect-[4/5] lg:aspect-auto"
        />
        <VideoCard clip={data[1]} className="aspect-video lg:aspect-auto" />
        <VideoCard clip={data[2]} className="aspect-video lg:aspect-auto" />
      </div>
    </section>
  );
}
