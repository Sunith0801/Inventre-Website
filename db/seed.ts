/**
 * Seed script — populates a fresh DB with the data we currently hard-code in
 * the frontend. Run with:  npm run db:seed
 *
 * Idempotent: safe to run multiple times. Truncates seed-controlled tables
 * before inserting.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import {
  schools,
  categories,
  products,
  productVariants,
  productImages,
  productBadges,
  productSchool,
  testimonials,
  faqs,
  contentBlocks,
  parents,
  students,
  users,
  // ─── Phase 1 (Option B) additions ───────────────────────────
  priceLists,
  itemPrices,
  warehouses,
  bins,
  taxRates,
  hsnCodes,
} from "./schema";
import * as schema from "./schema";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

// Match the encoding used in lib/products.ts
const enc = (s: string) => encodeURI(s);

async function main() {
  console.log("→ truncating seed-controlled tables…");
  await db.execute(/* sql */ `
    TRUNCATE TABLE
      content_blocks, faqs, testimonials,
      bins, item_prices, price_lists, warehouses, tax_rates, hsn_codes,
      product_badges, product_images, product_variants, product_school,
      products, categories, schools, students, parents, users
    CASCADE;
  `);

  // ─── PHASE 1: PRICE LISTS / WAREHOUSES / TAX / HSN ───────
  console.log("→ price lists, warehouses, tax rates, HSN codes");

  const [stdSelling, mrpList, posRetail] = await db
    .insert(priceLists)
    .values([
      { name: "Standard Selling", appliesTo: "selling", isDefault: true },
      { name: "MRP", appliesTo: "selling" },
      { name: "POS Retail", appliesTo: "selling" },
    ])
    .returning();

  const [defaultWarehouse] = await db
    .insert(warehouses)
    .values([
      {
        name: "Stores - IESPL",
        code: "STORES_IESPL",
        isDefault: true,
        address: {
          line1: "24th Floor, One West",
          line2: "Nanakramguda",
          city: "Hyderabad",
          state: "Telangana",
          pincode: "500032",
          country: "India",
        },
      },
    ])
    .returning();

  await db.insert(taxRates).values([
    {
      name: "GST 18%",
      cgstRate: "9",
      sgstRate: "9",
      igstRate: "18",
      isDefault: false,
    },
    {
      name: "GST 12%",
      cgstRate: "6",
      sgstRate: "6",
      igstRate: "12",
      isDefault: false,
    },
    {
      name: "GST 5%",
      cgstRate: "2.5",
      sgstRate: "2.5",
      igstRate: "5",
      isDefault: false,
    },
    {
      name: "Nil Rated",
      cgstRate: "0",
      sgstRate: "0",
      igstRate: "0",
      isDefault: true,
    },
    {
      name: "Exempt",
      cgstRate: "0",
      sgstRate: "0",
      igstRate: "0",
      isDefault: false,
    },
  ]);

  await db.insert(hsnCodes).values([
    {
      code: "61012000",
      description: "Garments, knitted, men/boys (Nil-Rated for school uniforms)",
      defaultGstRate: "0",
      category: "uniform",
    },
    {
      code: "61022000",
      description: "Garments, knitted, women/girls (Nil-Rated for school uniforms)",
      defaultGstRate: "0",
      category: "uniform",
    },
    {
      code: "64041100",
      description: "Sports footwear",
      defaultGstRate: "18",
      category: "footwear",
    },
    {
      code: "64041900",
      description: "Other footwear, textile uppers",
      defaultGstRate: "18",
      category: "footwear",
    },
    {
      code: "84713010",
      description: "Stationery, notebooks",
      defaultGstRate: "12",
      category: "stationery",
    },
    {
      code: "39239090",
      description: "Plastic articles (water bottles, lunch boxes)",
      defaultGstRate: "18",
      category: "accessories",
    },
    {
      code: "42022200",
      description: "School bags, backpacks",
      defaultGstRate: "18",
      category: "accessories",
    },
  ]);

  // ─── SCHOOLS ─────────────────────────────────────────────
  console.log("→ schools");
  const [indus, yellowTrain, winmore, greenwood, ekya, orchids, vibgyor, dps] =
    await db
      .insert(schools)
      .values([
        {
          slug: "indus-international",
          name: "Indus International School",
          city: "Bangalore",
          state: "Karnataka",
          status: "active",
          isFeatured: true,
        },
        {
          slug: "yellow-train",
          name: "Yellow Train International School",
          city: "Coimbatore",
          state: "Tamil Nadu",
          status: "active",
          isFeatured: true,
        },
        {
          slug: "winmore-academy",
          name: "Winmore Academy",
          city: "Bangalore",
          state: "Karnataka",
          status: "active",
          isFeatured: true,
          bannerUrl: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/school_banner2.jpg",
        },
        {
          slug: "greenwood-high",
          name: "Greenwood High",
          city: "Bangalore",
          state: "Karnataka",
          status: "active",
          isFeatured: true,
        },
        {
          slug: "ekya-schools",
          name: "Ekya Schools",
          city: "Bangalore",
          state: "Karnataka",
          status: "active",
          isFeatured: true,
        },
        {
          slug: "orchids",
          name: "Orchids The International School",
          city: "Bangalore",
          state: "Karnataka",
          status: "active",
          isFeatured: true,
        },
        {
          slug: "vibgyor",
          name: "VIBGYOR High",
          city: "Mumbai",
          state: "Maharashtra",
          status: "active",
          isFeatured: true,
        },
        {
          slug: "dps-bangalore",
          name: "DPS Bangalore",
          city: "Bangalore",
          state: "Karnataka",
          status: "active",
          isFeatured: true,
        },
      ])
      .returning();

  // ─── CATEGORIES (hierarchical) ───────────────────────────
  console.log("→ categories");
  const [uniform] = await db
    .insert(categories)
    .values({
      slug: "uniform",
      name: "Uniform",
      path: "uniform",
      sortOrder: 0,
    })
    .returning();

  const subUnderUniform = await db
    .insert(categories)
    .values([
      {
        slug: "winter",
        name: "Winter Uniform",
        parentId: uniform.id,
        path: "uniform.winter",
        sortOrder: 0,
      },
      {
        slug: "essentials",
        name: "Essentials",
        parentId: uniform.id,
        path: "uniform.essentials",
        sortOrder: 1,
      },
      {
        slug: "accessories",
        name: "Accessories",
        parentId: uniform.id,
        path: "uniform.accessories",
        sortOrder: 2,
      },
      {
        slug: "regular",
        name: "Regular",
        parentId: uniform.id,
        path: "uniform.regular",
        sortOrder: 3,
      },
      {
        slug: "sports",
        name: "Sports Uniform",
        parentId: uniform.id,
        path: "uniform.sports",
        sortOrder: 4,
      },
    ])
    .returning();

  const [winter, essentials, accessories, regular, sports] = subUnderUniform;

  await db.insert(categories).values([
    // winter children
    { slug: "hoodie", name: "Hoodie", parentId: winter.id, path: "uniform.winter.hoodie" },
    // essentials
    { slug: "bottle", name: "Bottle", parentId: essentials.id, path: "uniform.essentials.bottle" },
    { slug: "shoes", name: "Shoes", parentId: essentials.id, path: "uniform.essentials.shoes" },
    // accessories
    { slug: "bloomers", name: "Bloomers", parentId: accessories.id, path: "uniform.accessories.bloomers" },
    { slug: "tights", name: "Tights", parentId: accessories.id, path: "uniform.accessories.tights" },
    { slug: "scarf", name: "Scarf", parentId: accessories.id, path: "uniform.accessories.scarf" },
    { slug: "tie", name: "Tie", parentId: accessories.id, path: "uniform.accessories.tie" },
    { slug: "bow-tie", name: "Bow Tie", parentId: accessories.id, path: "uniform.accessories.bow-tie" },
    { slug: "caps", name: "Caps", parentId: accessories.id, path: "uniform.accessories.caps" },
    { slug: "belt", name: "Belt", parentId: accessories.id, path: "uniform.accessories.belt" },
    { slug: "bags", name: "Bags", parentId: accessories.id, path: "uniform.accessories.bags" },
    { slug: "socks", name: "Socks", parentId: accessories.id, path: "uniform.accessories.socks" },
    // regular
    { slug: "waist-coat", name: "Waist Coat", parentId: regular.id, path: "uniform.regular.waist-coat" },
    { slug: "blazers", name: "Blazers", parentId: regular.id, path: "uniform.regular.blazers" },
    { slug: "t-shirt", name: "T-Shirt", parentId: regular.id, path: "uniform.regular.t-shirt" },
    { slug: "skort", name: "Skort", parentId: regular.id, path: "uniform.regular.skort" },
    { slug: "frock", name: "Frock", parentId: regular.id, path: "uniform.regular.frock" },
    { slug: "skirt", name: "Skirt", parentId: regular.id, path: "uniform.regular.skirt" },
    { slug: "half-pants", name: "Half Pants", parentId: regular.id, path: "uniform.regular.half-pants" },
    { slug: "full-pants", name: "Full Pants", parentId: regular.id, path: "uniform.regular.full-pants" },
    { slug: "shirt", name: "Shirt", parentId: regular.id, path: "uniform.regular.shirt" },
    // sports
    { slug: "track-shorts", name: "Track Shorts", parentId: sports.id, path: "uniform.sports.track-shorts" },
    { slug: "rnt", name: "RNT", parentId: sports.id, path: "uniform.sports.rnt" },
    { slug: "track-pant", name: "Track Pant", parentId: sports.id, path: "uniform.sports.track-pant" },
    { slug: "sports-tshirt", name: "Tshirt", parentId: sports.id, path: "uniform.sports.sports-tshirt" },
  ]);

  // separately add Books Bundle
  await db.insert(categories).values({
    slug: "books-bundle",
    name: "Books Bundle",
    path: "books-bundle",
    sortOrder: 1,
  });

  // helper to look up category by path
  const cats = await db.select().from(categories);
  const byPath = (p: string) => {
    const c = cats.find((x) => x.path === p);
    if (!c) throw new Error(`Category not found: ${p}`);
    return c.id;
  };

  // ─── PRODUCTS ────────────────────────────────────────────
  console.log("→ products");
  const productSeed = [
    {
      slug: "regular-shirt",
      name: "Regular Uniform Shirt",
      categoryPath: "uniform.regular.shirt",
      basePrice: 54900, // paise
      baseMrp: 64900,
      tagline: null,
      sizes: ["18", "20", "22", "24", "26", "28", "30", "32", "34", "36", "38", "40", "42", "44", "46", "48"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/REGULAR UNIFORM.png"),
      badge: "BESTSELLER" as const,
      required: true,
      stockBase: 50,
    },
    {
      slug: "sports-set",
      name: "Sports Uniform Set",
      categoryPath: "uniform.sports.track-pant",
      basePrice: 89900,
      baseMrp: 99900,
      sizes: ["18", "20", "22", "24", "26", "28", "30", "32", "34", "36", "38", "40", "42", "44", "46", "48"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Sports uniform.png"),
      required: true,
      stockBase: 40,
    },
    {
      slug: "tshirt",
      name: "House T-Shirt",
      categoryPath: "uniform.regular.t-shirt",
      basePrice: 39900,
      baseMrp: 49900,
      sizes: ["18", "20", "22", "24", "26", "28", "30", "32", "34", "36", "38", "40", "42", "44", "46", "48"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Tshirt(product range).webp"),
      badge: "NEW" as const,
      required: false,
      stockBase: 8,
      tagline:
        "Pre-shrunk cotton-blend tee in your school's house colors. Soft on day one, holds shape after fifty washes.",
      description: [
        "The House T-Shirt is the everyday workhorse of the Inventre kit. Cut from a 200 GSM cotton-blend pique with a tailored collar, it sits clean under blazers and breathes through long sports periods.",
        "Engineered for Indian classrooms — the placket sits flat, the side seams are double-stitched against pull, and the collar holds its shape through monsoon-season laundry. Pre-shrunk so the fit you order is the fit your child wears in October.",
      ],
      specs: [
        { label: "Fabric", value: "60% Cotton · 40% Polyester pique, 200 GSM" },
        { label: "Fit", value: "Tailored regular (true to size)" },
        { label: "Care", value: "Machine wash cold · tumble dry low · low iron" },
        { label: "Origin", value: "Made in Tirupur, India" },
        { label: "Stitch", value: "Double-stitched seams · reinforced shoulder" },
        { label: "Approval", value: "School-approved house tee · Inventre QC tested" },
      ],
      sizeTable: [
        { size: "18", chest: "18 in", length: "16 in", sleeve: "5 in" },
        { size: "20", chest: "20 in", length: "17 in", sleeve: "5.5 in" },
        { size: "22", chest: "22 in", length: "18 in", sleeve: "6 in" },
        { size: "24", chest: "24 in", length: "19 in", sleeve: "6.5 in" },
        { size: "26", chest: "26 in", length: "20 in", sleeve: "7 in" },
        { size: "28", chest: "28 in", length: "21 in", sleeve: "7.5 in" },
        { size: "30", chest: "30 in", length: "22 in", sleeve: "8 in" },
        { size: "32", chest: "32 in", length: "23 in", sleeve: "8.5 in" },
        { size: "34", chest: "34 in", length: "24 in", sleeve: "9 in" },
        { size: "36", chest: "36 in", length: "25 in", sleeve: "9.5 in" },
        { size: "38", chest: "38 in", length: "26 in", sleeve: "10 in" },
        { size: "40", chest: "40 in", length: "27 in", sleeve: "10.5 in" },
        { size: "42", chest: "42 in", length: "28 in", sleeve: "11 in" },
        { size: "44", chest: "44 in", length: "28.5 in", sleeve: "11.25 in" },
        { size: "46", chest: "46 in", length: "29 in", sleeve: "11.5 in" },
        { size: "48", chest: "48 in", length: "29.5 in", sleeve: "12 in" },
      ],
    },
    {
      slug: "hoodie",
      name: "Winter Hoodie",
      categoryPath: "uniform.winter.hoodie",
      basePrice: 119900,
      baseMrp: 139900,
      sizes: ["S", "M", "L", "XL"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/WinterHoodie.png"),
      badge: "LOW_STOCK" as const,
      required: false,
      stockBase: 5,
    },
    {
      slug: "school-bag",
      name: "School Backpack",
      categoryPath: "uniform.accessories.bags",
      basePrice: 149900,
      sizes: ["Standard"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/bags.png"),
      required: true,
      stockBase: 60,
    },
    {
      slug: "school-shoes",
      name: "School Shoes",
      categoryPath: "uniform.essentials.shoes",
      basePrice: 129900,
      baseMrp: 149900,
      sizes: ["UK 1", "UK 2", "UK 3", "UK 4", "UK 5", "UK 6"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/shoes.png"),
      required: true,
      stockBase: 30,
    },
    {
      slug: "socks",
      name: "Uniform Socks (5 pairs)",
      categoryPath: "uniform.accessories.socks",
      basePrice: 44900,
      sizes: ["S", "M", "L"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/socks(product range).webp"),
      required: true,
      stockBase: 100,
    },
    {
      slug: "bottle",
      name: "Insulated Water Bottle",
      categoryPath: "uniform.essentials.bottle",
      basePrice: 59900,
      baseMrp: 69900,
      sizes: ["500ml", "750ml"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/bottle(product range).webp"),
      badge: "BESTSELLER" as const,
      required: true,
      stockBase: 80,
    },
    {
      slug: "accessories-bundle",
      name: "Accessories Bundle",
      categoryPath: "uniform.accessories",
      basePrice: 79900,
      sizes: ["One size"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/ACCESSORIES.png"),
      required: false,
      stockBase: 0, // out of stock
    },
    {
      slug: "essentials-kit",
      name: "K-12 Essentials Kit",
      categoryPath: "books-bundle",
      basePrice: 249900,
      baseMrp: 289900,
      sizes: ["S", "M", "L"],
      img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/All-K-12-essentials.webp"),
      badge: "BESTSELLER" as const,
      required: false,
      stockBase: 25,
    },
  ];

  for (const p of productSeed) {
    const [prod] = await db
      .insert(products)
      .values({
        slug: p.slug,
        name: p.name,
        categoryId: byPath(p.categoryPath),
        basePrice: p.basePrice,
        baseMrp: p.baseMrp,
        tagline: p.tagline ?? null,
        description: p.description ?? null,
        specs: p.specs ?? null,
        sizeTable: p.sizeTable ?? null,
        status: "active",
      })
      .returning();

    // primary image
    await db.insert(productImages).values({
      productId: prod.id,
      url: p.img,
      alt: p.name,
      sortOrder: 0,
    });

    // variants per size — also populate bins (Phase 3 source of truth) and
    // item_prices (Phase 3 source of truth). Legacy stockQty/basePrice kept
    // populated until Phase 3 cuts over reads.
    const insertedVariants = await db
      .insert(productVariants)
      .values(
        p.sizes.map((size) => ({
          productId: prod.id,
          size,
          sku: `${p.slug.toUpperCase()}-${size.toUpperCase()}`,
          stockQty: p.stockBase,
          lowStockThreshold: 5,
        }))
      )
      .returning();

    await db.insert(bins).values(
      insertedVariants.map((v) => ({
        variantId: v.id,
        warehouseId: defaultWarehouse.id,
        actualQty: p.stockBase,
        reservedQty: 0,
        minStockLevel: 5,
        valuationRate: Math.round(p.basePrice * 0.6), // rough cost = 60% of selling
      }))
    );

    await db.insert(itemPrices).values(
      insertedVariants.map((v) => ({
        variantId: v.id,
        priceListId: stdSelling.id,
        price: p.basePrice,
      }))
    );

    // badge
    if (p.badge) {
      await db.insert(productBadges).values({ productId: prod.id, badge: p.badge });
    }

    // assign to Winmore (current demo school)
    await db.insert(productSchool).values({
      productId: prod.id,
      schoolId: winmore.id,
      isRequired: p.required,
    });
  }

  // ─── TESTIMONIALS ────────────────────────────────────────
  console.log("→ testimonials");
  await db.insert(testimonials).values([
    {
      schoolId: indus.id,
      principalName: "Mrs. Aparna Menon",
      role: "Principal",
      shortLabel: "INDUS INTL",
      quote:
        "Our parents stopped chasing five vendors before every term. One labeled box arrives, sorted by class. The relief is real.",
      photoUrl: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/testimonial_1.jpg",
      sortOrder: 0,
    },
    {
      schoolId: yellowTrain.id,
      principalName: "Mrs. Chitra Sharma",
      role: "Principal",
      shortLabel: "YELLOW TRAIN",
      quote:
        "The fabrics held up through monsoon, sports and a full academic year. Stitching is institutional grade — not retail.",
      photoUrl: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Chitra Sharma_testimonial.jpg",
      sortOrder: 1,
    },
    {
      schoolId: winmore.id,
      principalName: "Mrs. Sushma K.",
      role: "Principal",
      shortLabel: "WINMORE",
      quote:
        "They treat our crest like their own. Color-matched, embroidered, consistent across 800 kids. That's brand work.",
      photoUrl: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/testimonial_2.jpg",
      sortOrder: 2,
    },
  ]);

  // ─── FAQs ────────────────────────────────────────────────
  console.log("→ faqs");
  await db.insert(faqs).values([
    {
      question: "How does the school selector work?",
      answer:
        "Pick your school from the dropdown — we'll auto-load that school's exact uniform spec, color codes, fabrics, and approved sizes. You only see what's actually approved for your child's school.",
      sortOrder: 0,
    },
    {
      question: "What if my child's size doesn't fit?",
      answer:
        "Free exchanges within 14 days. Order any size, try at home, and we'll swap or refund — pickup is on us.",
      sortOrder: 1,
    },
    {
      question: "How long does delivery take?",
      answer:
        "Most orders ship within 3 business days and arrive within 5–7 days nationwide. Pre-term bulk orders are scheduled to arrive a week before classes start.",
      sortOrder: 2,
    },
    {
      question: "Can my school become an Inventre partner?",
      answer:
        "Yes — we onboard schools year-round. Tap 'Partner with us' or email hello@inventre.in. A typical onboarding takes 4–6 weeks.",
      sortOrder: 3,
    },
    {
      question: "Is the fabric tested for kids?",
      answer:
        "Every fabric is tested for colorfastness, shrinkage, abrasion resistance, and skin safety. We use the same standards as institutional uniform suppliers — not retail.",
      sortOrder: 4,
    },
    {
      question: "Do you customize for individual schools?",
      answer:
        "That's the entire point. Crest embroidery, ties, blazer piping, sports kit colors — we replicate your school's spec exactly.",
      sortOrder: 5,
    },
  ]);

  // ─── CONTENT BLOCKS (homepage CMS data) ──────────────────
  console.log("→ content_blocks");
  await db.insert(contentBlocks).values([
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
  ]);

  // Demo parent + student block removed — production parents register
  // via /login OTP and are matched against ERP-sourced students by
  // guardian phone overlap. The old seed planted a "Teja Parent /
  // 9999999999 / inventre123" account, which gave a misleading view of
  // real user data. If you need a development account, create one via
  // the normal registration flow against a real ERP guardian phone.

  // ─── DEMO ADMIN ──────────────────────────────────────────
  console.log("→ demo admin");
  await db.insert(users).values({
    email: "admin@inventre.in",
    passwordHash: await bcrypt.hash("admin123", 10),
    role: "super",
    name: "Inventre Admin",
  });

  console.log("✓ seed complete");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
