import "server-only";
import { eq, asc, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { contentBlocks, faqs, testimonials, schools } from "@/db/schema";
import { cached } from "@/server/cache";

// ── default fallbacks (used when DB is missing a block) ─────

const DEFAULTS = {
  saleStrip: {
    items: [
      "SALE IS LIVE",
      "FREE SHIPPING ON KITS",
      "TRY BEFORE YOU BUY",
      "BACK TO SCHOOL '26",
    ],
  },
  hero: {
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
  stats: [
    { value: 20000, suffix: "+", label: "Happy students" },
    { value: 40, suffix: "+", label: "Partner schools" },
    { value: 98, suffix: "%", label: "School renewal rate" },
    { value: 14, suffix: "d", label: "Free returns window" },
  ],
  inTheWild: {
    heading: "Real schools. Real kids. Real first-day pride.",
    sub: "Captured at our partner schools across India.",
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
  howItWorks: [
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
};

// ── types ───────────────────────────────────────────────────

export type HomePageData = {
  saleStrip: typeof DEFAULTS.saleStrip;
  hero: typeof DEFAULTS.hero;
  stats: typeof DEFAULTS.stats;
  inTheWild: typeof DEFAULTS.inTheWild;
  howItWorks: typeof DEFAULTS.howItWorks;
  trustSchools: { id: string; name: string }[];
  /** Schools to populate the homepage hero dropdown — featured first, all active. */
  pickerSchools: { slug: string; name: string }[];
  testimonials: {
    id: string;
    name: string;
    role: string;
    school: string;
    shortLabel: string;
    quote: string;
    photoUrl: string | null;
  }[];
  faqs: { id: string; question: string; answer: string }[];
};

// ── loader ──────────────────────────────────────────────────

async function getBlock<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db
    .select()
    .from(contentBlocks)
    .where(eq(contentBlocks.key, key))
    .limit(1);
  return ((row?.data as T) ?? fallback) as T;
}

export async function getHomePageData(): Promise<HomePageData> {
  return cached("home:all", 600, async () => {
    const [
      saleStrip,
      hero,
      stats,
      inTheWild,
      howItWorks,
      activeSchools,
      tRows,
      fRows,
    ] = await Promise.all([
      getBlock<HomePageData["saleStrip"]>("home.sale_strip", DEFAULTS.saleStrip),
      getBlock<HomePageData["hero"]>("home.hero", DEFAULTS.hero),
      getBlock<HomePageData["stats"]>("home.stats", DEFAULTS.stats),
      getBlock<HomePageData["inTheWild"]>("home.in_the_wild", DEFAULTS.inTheWild),
      getBlock<HomePageData["howItWorks"]>("home.how_it_works", DEFAULTS.howItWorks),
      // Single pass over schools — partitioned in JS into trust (featured) and picker (all active).
      db
        .select({
          id: schools.id,
          name: schools.name,
          slug: schools.slug,
          isFeatured: schools.isFeatured,
        })
        .from(schools)
        .where(eq(schools.status, "active"))
        .orderBy(desc(schools.isFeatured), asc(schools.name)),
      db
        .select({ t: testimonials, school: schools })
        .from(testimonials)
        .leftJoin(schools, eq(schools.id, testimonials.schoolId))
        .where(eq(testimonials.isFeatured, true))
        .orderBy(asc(testimonials.sortOrder))
        .limit(3),
      db
        .select()
        .from(faqs)
        .where(eq(faqs.isActive, true))
        .orderBy(asc(faqs.sortOrder)),
    ]);

    return {
      saleStrip,
      hero,
      stats,
      inTheWild,
      howItWorks,
      trustSchools: activeSchools
        .filter((s) => s.isFeatured)
        .map(({ id, name }) => ({ id, name })),
      pickerSchools: activeSchools.map(({ slug, name }) => ({ slug, name })),
      testimonials: tRows.map(({ t, school }) => ({
        id: t.id,
        name: t.principalName,
        role: t.role,
        school: school?.name ?? "",
        shortLabel:
          t.shortLabel ?? school?.name?.split(" ")[0]?.toUpperCase() ?? "",
        quote: t.quote,
        photoUrl: t.photoUrl,
      })),
      faqs: fRows.map((f) => ({
        id: f.id,
        question: f.question,
        answer: f.answer,
      })),
    };
  });
}
