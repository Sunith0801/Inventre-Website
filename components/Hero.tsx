"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Star } from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: i * 0.08 },
  }),
};

const trust = [
  { k: "17+", v: "schools" },
  { k: "20,000+", v: "students" },
  { k: "4.8★", v: "parent rating" },
  { k: "Free", v: "returns" },
];

type HeroData = {
  eyebrow?: string;
  headlineTop?: string;
  headlineMid?: string;
  headlineHighlight?: string;
  headlineEnd?: string;
  sub?: string;
  ctaPrimary?: string;
  videoUrl?: string;
  videoCaption?: string;
};

// HeroSchool used to feed the upfront school selector. The selector is
// gone — parents identify themselves by mobile and the right school /
// child kit is loaded from their enrollment record. Kept exported (no
// callers in tree but external uses may exist) so a stale import elsewhere
// doesn't break the build.
export type HeroSchool = { slug: string; name: string };

export function Hero({
  hero,
  media,
}: {
  hero?: HeroData;
  media?: { heroVideo?: string };
} = {}) {
  const router = useRouter();
  const eyebrow = hero?.eyebrow ?? "Now serving 17+ schools across India";
  const sub =
    hero?.sub ??
    "Uniforms, bags, shoes, accessories — every essential, branded by your child's school and shipped straight to your door. Sign in with your registered mobile, we'll do the rest.";
  const ctaPrimary = hero?.ctaPrimary ?? "Sign in to shop";
  // Editable via /admin/content/media (slot key: media.home.hero.video).
  // No poster image — the dark card background shows briefly until the
  // video buffers in, avoiding the "apple placeholder" flash.
  const videoUrl = media?.heroVideo ?? hero?.videoUrl ?? "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/slider_1.mp4";
  const videoCaption =
    hero?.videoCaption ?? "Indus International — first day of term";
  return (
    <section className="relative overflow-hidden">
      {/* soft background gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 55% at 85% 10%, rgba(228,113,39,0.22) 0%, rgba(228,113,39,0) 65%), radial-gradient(60% 50% at 0% 100%, rgba(228,113,39,0.12) 0%, rgba(228,113,39,0) 65%), linear-gradient(180deg, #FFF6EC 0%, #FAF7F2 60%)",
        }}
      />
      {/* graph-paper grid — clearly visible across the section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(15,15,15,0.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(15,15,15,0.12) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
      {/* orange dot at every intersection */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(circle at 0 0, rgba(228,113,39,0.7) 2px, transparent 2.5px)",
          backgroundSize: "60px 60px",
        }}
      />
      {/* very gentle bottom fade so content doesn't clip into next section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(250,247,242,0) 0%, rgba(250,247,242,1) 100%)",
        }}
      />

      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-12 md:pt-20 pb-16 md:pb-28">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left: copy */}
          <div className="lg:col-span-7">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="show"
              custom={0}
              className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-cream px-3 py-1.5"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
              <span className="text-[12px] font-medium tracking-wide text-ink-700">
                {eyebrow}
              </span>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="show"
              custom={1}
              className="mt-6 font-display font-extrabold text-ink-900"
              style={{
                fontSize: "clamp(2rem, 4.4vw, 4rem)",
                lineHeight: "0.98",
                letterSpacing: "-0.035em",
              }}
            >
              Your child&apos;s
              <br className="hidden sm:block" /> entire <span className="text-brand">school kit</span>.
              <br />
              <span className="relative inline-block text-brand">
                One box.
                <svg
                  aria-hidden
                  className="absolute -bottom-2 left-0 w-full"
                  viewBox="0 0 300 12"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M2 9 C 80 2, 220 2, 298 8"
                    fill="none"
                    stroke="#E47127"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>{" "}
              Delivered.
            </motion.h1>

            <motion.p
              variants={fadeUp}
              initial="hidden"
              animate="show"
              custom={2}
              className="mt-6 max-w-xl text-[16px] md:text-[17px] leading-relaxed text-ink-600"
            >
              {sub}
            </motion.p>

            {/* Primary CTAs — parents sign in with their registered
                mobile (school is auto-derived from the child's enrollment;
                no need to pick one upfront). */}
            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="show"
              custom={3}
              className="mt-8 flex flex-col sm:flex-row items-stretch gap-3 max-w-xl"
            >
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="group inline-flex items-center justify-center gap-2 rounded-full bg-brand px-7 py-4 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-brand-600 active:scale-[0.98] transition-all"
              >
                {ctaPrimary}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href="#how"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-ink-200 bg-white px-7 py-4 text-[15px] font-semibold text-ink-900 hover:border-ink-900 transition-colors"
              >
                How it works
              </a>
            </motion.div>

            <motion.p
              variants={fadeUp}
              initial="hidden"
              animate="show"
              custom={4}
              className="mt-3 text-[13px] text-ink-500"
            >
              Sign in with the mobile number your school has on file.
              We&apos;ll load your child&apos;s kit automatically — no school
              picker, no forms.
            </motion.p>

            {/* trust strip */}
            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="show"
              custom={5}
              className="mt-10 flex flex-wrap gap-x-8 gap-y-3"
            >
              {trust.map((t) => (
                <div key={t.v} className="flex items-baseline gap-2">
                  <span className="font-display text-[20px] font-bold text-ink-900">
                    {t.k}
                  </span>
                  <span className="text-[13px] text-ink-500">{t.v}</span>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right: visual */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={2}
            className="lg:col-span-5"
          >
            <HeroVisual videoUrl={videoUrl} videoCaption={videoCaption} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function HeroVisual({
  videoUrl,
  videoCaption,
}: {
  videoUrl: string;
  videoCaption: string;
}) {
  // Container is squarish-portrait (4:5 → 3:4). object-cover fills
  // the entire card edge-to-edge; vertical 9:16 uploads will be
  // cropped top/bottom. For perfect framing, upload sources at 4:5
  // (e.g. 1080×1350) or wider portrait — they'll fit without crop.
  return (
    <div className="relative aspect-[4/5] sm:aspect-[3/4] lg:aspect-[4/5] w-full">
      <div className="relative h-full w-full overflow-hidden rounded-[28px] border border-ink-200 bg-ink-900 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.35)]">
        {/* Original `object-cover` filled the card naturally — the
            "dark sliver" turned out to be the user's source video
            having its own dark vignette, not a layout issue. Keep
            video pinned to the card with full inset; no bleed. */}
        <video preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          src={videoUrl}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/80 via-ink-900/0 to-ink-900/10" />
        <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-3 text-white">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase opacity-80">
              In the wild
            </p>
            <p className="mt-1 text-[14px] font-medium">{videoCaption}</p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-white/15 backdrop-blur px-3 py-1.5 text-[12px] font-medium">
            <Star className="h-3.5 w-3.5 fill-white" /> 4.8
          </div>
        </div>
      </div>

      {/* overlap card — "what's in the box" preview with REAL product images */}
      <div className="absolute -bottom-6 -left-4 sm:-left-6 w-[60%] rounded-2xl border border-ink-200 bg-white p-4 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between">
          <p className="font-display text-[11px] font-semibold tracking-[0.18em] uppercase text-brand">
            What&apos;s inside
          </p>
          <span className="rounded-full bg-brand-50 text-brand-700 px-2 py-0.5 text-[10px] font-bold tracking-wider">
            8 ITEMS
          </span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[
            { name: "Shirt", src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Tshirt(product range).webp" },
            { name: "Bag", src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/bags.png" },
            { name: "Shoes", src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/shoes.png" },
            { name: "Socks", src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/socks(product range).webp" },
            { name: "Bottle", src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/bottle(product range).webp" },
            { name: "Hoodie", src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/WinterHoodie.png" },
            { name: "Sports", src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Sports uniform.png" },
            { name: "Kit", src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/All-K-12-essentials.webp" },
          ].map((it) => (
            <div
              key={it.name}
              className="group/item relative aspect-square overflow-hidden rounded-md bg-cream-100 border border-ink-100 hover:border-brand transition-colors"
              title={it.name}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={encodeURI(it.src)}
                alt={it.name}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-contain p-1.5 transition-transform duration-300 group-hover/item:scale-110"
              />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-ink-500">
          One box. Branded by your school.
        </p>
      </div>
    </div>
  );
}
