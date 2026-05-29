/**
 * Seed home.* content blocks with the same defaults Hero/HowItWorks/InTheWild
 * fall back to. Idempotent — only inserts blocks that don't already exist.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentBlocks } from "@/db/schema";

const BLOCKS: { key: string; data: unknown }[] = [
  {
    key: "home.sale_strip",
    data: {
      items: [
        "SALE IS LIVE",
        "FREE SHIPPING ON KITS",
        "TRY BEFORE YOU BUY",
        "BACK TO SCHOOL '26",
      ],
    },
  },
  {
    key: "home.hero",
    data: {
      eyebrow: "Now serving 40+ schools across India",
      headlineTop: "Your child's",
      headlineMid: "entire school kit.",
      headlineHighlight: "One box.",
      headlineEnd: "Delivered.",
      sub: "Uniforms, bags, shoes, accessories — every essential, branded by your school and shipped straight to your door. Try before you buy. No vendor chase. No queues.",
      ctaPrimary: "Shop the kit",
      videoUrl: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/slider_1.mp4",
      videoCaption: "Indus International — first day of term",
    },
  },
  {
    key: "home.stats",
    data: [
      { value: 20000, suffix: "+", label: "Happy students" },
      { value: 40, suffix: "+", label: "Partner schools" },
      { value: 98, suffix: "%", label: "School renewal rate" },
      { value: 14, suffix: "d", label: "Free returns window" },
    ],
  },
  {
    key: "home.how_it_works",
    data: [
      {
        n: "01",
        icon: "Search",
        title: "Pick your school",
        body: "Find your school in our partner list. We auto-load the right uniform spec, sizes, and brand colors.",
      },
      {
        n: "02",
        icon: "Package",
        title: "Build the kit",
        body: "Choose what your child needs — full kit or individual items. Try-before-you-buy on first orders.",
      },
      {
        n: "03",
        icon: "Truck",
        title: "Doorstep delivery",
        body: "One labeled box, on time, before term starts. Free returns and exchanges within 14 days.",
      },
    ],
  },
  {
    key: "home.in_the_wild",
    data: {
      heading: "Real schools. Real kids. Real first-day pride.",
      sub: "Captured at our partner schools across India. Tap the speaker to unmute.",
      clips: [
        {
          src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/slider_1.mp4",
          caption: "Crafting your school's brand story",
          meta: "Indus International · Term opening",
        },
        {
          src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/slider_2.mp4",
          caption: "Inspiring young minds",
          meta: "Yellow Train · Sports day",
        },
        {
          src: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/slider_3.mp4",
          caption: "Building future leaders",
          meta: "Winmore Academy · Annual day",
        },
      ],
    },
  },
];

async function main() {
  let inserted = 0;
  let skipped = 0;
  for (const b of BLOCKS) {
    const [existing] = await db
      .select({ key: contentBlocks.key })
      .from(contentBlocks)
      .where(eq(contentBlocks.key, b.key))
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }
    await db
      .insert(contentBlocks)
      .values({ key: b.key, data: b.data as never });
    inserted++;
  }
  console.log(
    `Done. inserted=${inserted} already-present=${skipped} (of ${BLOCKS.length})`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
