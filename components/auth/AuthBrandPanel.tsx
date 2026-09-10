"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function AuthBrandPanel({
  imageUrl = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/school_banner2.jpg",
  logoUrl = "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/INVENTRE_LOGO.png",
}: {
  imageUrl?: string;
  logoUrl?: string;
} = {}) {
  const isVideo = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv)(\?|$)/i.test(imageUrl);
  return (
    <aside className="relative hidden lg:flex lg:w-[55%] flex-col overflow-hidden bg-ink-900 text-white">
      {/* photo or video background */}
      {isVideo ? (
         
        <video
          src={imageUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="Indian school campus"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* Light vignette only at the bottom for caption legibility —
          the image itself stays bright + visible. No global wash, no
          orange radial (those darkened everything and made the photo
          look "dull"). */}
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-ink-900/85 via-ink-900/40 to-transparent" />
      {/* Tiny dim at the top to anchor the logo against bright skies. */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-ink-900/40 to-transparent" />

      {/* logo top-left */}
      <div className="relative z-10 px-10 lg:px-14 py-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt="Inventre"
          className="h-9 brightness-0 invert"
        />
      </div>

      {/* main content — centered vertically in remaining space */}
      <div className="relative z-10 flex-1 flex items-center px-10 lg:px-14 pb-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-lg"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-black/30 backdrop-blur-md border border-white/15 px-3 py-1.5">
            <Sparkles className="h-3.5 w-3.5 text-brand-300" />
            <span className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase">
              Inventre · Parent Portal
            </span>
          </span>

          {/* Smaller heading + softer weight so it doesn't dominate the
              image. Drop-shadow keeps it readable on any background. */}
          <h2 className="mt-5 font-display text-[26px] lg:text-[32px] font-bold tracking-tight leading-[1.1] [text-shadow:0_2px_18px_rgba(0,0,0,0.55)]">
            Your child&apos;s school kit,{" "}
            <span className="text-brand-300">in one box.</span>
          </h2>
          <p className="mt-3 text-[13.5px] text-white/90 leading-relaxed max-w-md [text-shadow:0_1px_10px_rgba(0,0,0,0.55)]">
            Sign in to see uniforms, accessories and essentials approved by
            your school. Branded, sized, and delivered home.
          </p>

          <div className="mt-7 flex items-center gap-6 text-[11px] text-white/80">
            <div>
              <p className="font-display text-[22px] font-extrabold text-white leading-none [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]">
                17+
              </p>
              <p className="mt-1 tracking-wider uppercase">Schools</p>
            </div>
            <div className="h-9 w-px bg-white/25" />
            <div>
              <p className="font-display text-[22px] font-extrabold text-white leading-none [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]">
                20K+
              </p>
              <p className="mt-1 tracking-wider uppercase">Students</p>
            </div>
            <div className="h-9 w-px bg-white/25" />
            <div>
              <p className="font-display text-[22px] font-extrabold text-white leading-none [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]">
                4.8★
              </p>
              <p className="mt-1 tracking-wider uppercase">Rated</p>
            </div>
          </div>
        </motion.div>
      </div>
    </aside>
  );
}
