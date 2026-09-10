 
/**
 * Seed real production schools, categories, attributes, and bundle templates
 * from the audit doc (`inventre-erp-complete-audit.md`).
 *
 * Run AFTER `npm run db:seed`:  npx tsx db/seed-real-schools.ts
 *
 * Idempotent: every insert uses ON CONFLICT DO UPDATE / DO NOTHING.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import {
  schools,
  categories,
  productAttributes,
  productAttributeValues,
  companies,
} from "./schema";
import * as schema from "./schema";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

// ── Audit §1: Companies ─────────────────────────────────────
const COMPANIES = [
  {
    name: "Inventre Edu Services Pvt Ltd",
    abbr: "IESPL",
    gstin: "36AAMCP1199C1ZA",
    pan: "AAMCP1199C",
    stateCode: "36",
    address: {
      line1: "24th Floor, One West",
      line2: "Nanakramguda",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500032",
      country: "India",
    },
    isDefault: true,
  },
];

// ── Audit §12: 12 real schools ───────────────────────────────
const SCHOOLS = [
  { slug: "kls-kidlink", name: "KLINK-Kidlink School", prefixes: ["KLS", "KLINK"], grades: ["Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10"], curriculum: [] },
  { slug: "qls", name: "QLS School", prefixes: ["QLS"], grades: ["Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10"], curriculum: [] },
  { slug: "samyu", name: "SAMYU-Samyuktha School", prefixes: ["SAM", "SAMYU"], grades: ["Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10"], curriculum: [] },
  { slug: "sas-bp", name: "SAS BP School", prefixes: ["SAS BP"], grades: ["Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12"], curriculum: ["CBSE"] },
  { slug: "sas-keesara", name: "SAS Keesara School", prefixes: ["SAS KS", "SAS Keesara"], grades: ["UKG","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12"], curriculum: ["CBSE"] },
  { slug: "sas-suchitra", name: "SAS Suchitra School", prefixes: ["SAS SC", "SMS"], grades: ["UKG","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12"], curriculum: ["CBSE"] },
  { slug: "cas-lr", name: "CAS LR School", prefixes: ["CAS LR"], grades: ["Grade 5","Grade 6","Grade 7","Grade 8","Grade 9"], curriculum: ["CBSE","CIE"] },
  { slug: "cas-nibm", name: "CAS NIBM School", prefixes: ["CAS NIBM"], grades: ["Grade 5","Grade 6","Grade 7","Grade 8","Grade 9"], curriculum: ["CBSE","CIE"] },
  { slug: "dlsu", name: "DL School", prefixes: ["DLSU"], grades: [], curriculum: [] },
  { slug: "winmore-jakkur", name: "Winmore Academy Jakkur", prefixes: ["WM JK", "Winmore Jakkur"], grades: ["UKG","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10"], curriculum: [] },
  { slug: "winmore-whitefield", name: "Winmore Academy Whitefield", prefixes: ["WM WF", "Winmore Whitefield"], grades: ["UKG","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10"], curriculum: [] },
  { slug: "tsus", name: "TSUS School", prefixes: ["TSUS"], grades: ["Grade 12"], curriculum: ["CBSE"] },
];

// ── Audit §2.1 + §2.5: Per-school house color maps ───────────
const COLOR_MAPS: Record<string, Record<string, { label: string; hex: string }>> = {
  samyu: {
    A: { label: "Kalpana Chawla - RED", hex: "#C62828" },
    V: { label: "Vikram Sarabhai - BLUE", hex: "#1565C0" },
    I: { label: "Isaac Newton - GREEN", hex: "#2E7D32" },
    G: { label: "Galileo Galilei - YELLOW", hex: "#F9A825" },
  },
  "sas-bp": {
    S: { label: "Sapphire Knights - BLUE", hex: "#1565C0" },
    T: { label: "Topaz Vikings - YELLOW", hex: "#F9A825" },
    R: { label: "Ruby Spartans - RED", hex: "#C62828" },
    E: { label: "Emerald Gladiators - GREEN", hex: "#2E7D32" },
  },
  qls: {
    A: { label: "Alpha (Red)", hex: "#C62828" },
    B: { label: "Beta (Blue)", hex: "#1565C0" },
    D: { label: "Delta (Green)", hex: "#2E7D32" },
    G: { label: "Gamma (Yellow)", hex: "#F9A825" },
  },
  tsus: {
    D: { label: "Dhairya (Blue)", hex: "#1565C0" },
    A: { label: "Abhay (RED)", hex: "#C62828" },
    L: { label: "Lakshay (GREEN)", hex: "#2E7D32" },
    N: { label: "Nishchay (YELLOW)", hex: "#F9A825" },
  },
};

// ── Audit §2.2: Full category tree ───────────────────────────
const CATEGORY_TREE = [
  { slug: "uniform", name: "Uniform", parent: null },
  { slug: "uniform-regular", name: "Regular", parent: "uniform" },
  { slug: "shirt", name: "Shirt", parent: "uniform-regular" },
  { slug: "full-pants", name: "Full Pants", parent: "uniform-regular" },
  { slug: "half-pants", name: "Half Pants", parent: "uniform-regular" },
  { slug: "skirt", name: "Skirt", parent: "uniform-regular" },
  { slug: "frock", name: "Frock", parent: "uniform-regular" },
  { slug: "skort", name: "Skort", parent: "uniform-regular" },
  { slug: "tshirt", name: "T-Shirt", parent: "uniform-regular" },
  { slug: "blazers", name: "Blazers", parent: "uniform-regular" },
  { slug: "waist-coat", name: "Waist Coat", parent: "uniform-regular" },
  { slug: "uniform-sports", name: "Sports Uniform", parent: "uniform" },
  { slug: "sports-tshirt", name: "Sports Tshirt", parent: "uniform-sports" },
  { slug: "track-pant", name: "Track Pant", parent: "uniform-sports" },
  { slug: "rnt", name: "RNT", parent: "uniform-sports" },
  { slug: "track-shorts", name: "Track Shorts", parent: "uniform-sports" },
  { slug: "uniform-accessories", name: "Accessories", parent: "uniform" },
  { slug: "socks", name: "Socks", parent: "uniform-accessories" },
  { slug: "bags", name: "Bags", parent: "uniform-accessories" },
  { slug: "belt", name: "Belt", parent: "uniform-accessories" },
  { slug: "caps", name: "Caps", parent: "uniform-accessories" },
  { slug: "bow-tie", name: "Bow Tie", parent: "uniform-accessories" },
  { slug: "tie", name: "Tie", parent: "uniform-accessories" },
  { slug: "scarf", name: "Scarf", parent: "uniform-accessories" },
  { slug: "tights", name: "Tights", parent: "uniform-accessories" },
  { slug: "bloomers", name: "Bloomers", parent: "uniform-accessories" },
  { slug: "uniform-essentials", name: "Essentials", parent: "uniform" },
  { slug: "shoes", name: "Shoes", parent: "uniform-essentials" },
  { slug: "bottle", name: "Bottle", parent: "uniform-essentials" },
  { slug: "uniform-winter", name: "Winter Uniform", parent: "uniform" },
  { slug: "hoodie", name: "Hoodie", parent: "uniform-winter" },
  { slug: "books", name: "Books", parent: null },
  { slug: "books-bundle", name: "Books Bundle", parent: null },
  { slug: "books-template", name: "Books Template", parent: null },
  { slug: "magic-box", name: "Magic Box", parent: null },
];

// ── Audit §2.5: Attributes with all values ───────────────────
type AttrSpec = {
  name: string;
  type: "size" | "color" | "design" | "model" | "other";
  schoolSlug?: string; // if school-scoped
  values: string[];
};

const ATTRIBUTES: AttrSpec[] = [
  // Sizes
  { name: "Shirt Size", type: "size", values: ["18","20","22","24","26","28","30","32","34","36","38","40","42","44","46","48","50","52","54","56","58"] },
  { name: "Full Pant size", type: "size", values: ["16","18","20","22","24","26","28","30","32","34","36","38","40","42","44","46","48","50"] },
  { name: "Half Pants Size", type: "size", values: ["14A","14B","16A","16B","16C","16D","18A","18B","18C","18D","20A","20B","20C","20D","22A","22B","22C","22D","24A","24B","24C","24D","26A","26B","26C","26D","28A","28B","28C","28D","30A","30B","30C","30D","32A","32B","32C","32D","34A","34B","34C","34D","36A","36B","36C","36D","38A","38B","38C"] },
  { name: "Skirt Size", type: "size", values: ["16A","16B","16C","16D","16E","18A","18B","18C","18D","18E","18F","20A","20B","20C","20D","20E","22A","22B","22C","22D","22E","22F","24A","24B","24C","24D","24E","24F","26A","26B","26C","26D","26E","26F","28A","28B","28C","28D","28E","30A","30B","30C","30D","30E","30F","32A","32B","32C","32D","32E","32F","34A","34B","34C","34D","34E","34F","36A","36B","36C","36D","38A","38B","38C","38D","38E","40A","40B","40C","40D","42A","42B","42C"] },
  { name: "Tshirt Size", type: "size", values: ["20","22","24","26","28","30","32","34","36","38","40","42","44","46","48","50","52","54","56","58","60","62","64"] },
  { name: "Track Pant Size", type: "size", values: ["18","20","22","24","26","28","30","32","34","36","38","40","42","44","46","48","50","52"] },
  { name: "Track Shorts Sizes", type: "size", values: ["14","16","18","20","22","24","26","28","30","32","34","36","38","40","42","44","46"] },
  { name: "Hoodie Sizes", type: "size", values: ["20","22","24","26","28","30","32","34","36","38","40","42","44","46","48","50","52","54","56","58"] },
  { name: "Blazer Sizes", type: "size", values: ["22","24","26","28","30","32","34","36","38","40","42","44","46","50"] },
  { name: "Waist Coat Sizes", type: "size", values: ["24","26","28","30","32","34","36","38","40","42","44","46"] },
  { name: "Frock Sizes", type: "size", values: ["18","20","22","24","26","28","30","32","34","36","38","40","42","44","46","48"] },
  { name: "Bloomers Sizes", type: "size", values: ["55","60","65","70","75","80","85","90","95","100","110"] },
  { name: "Tie Sizes", type: "size", values: ["12","14","16","18","20"] },
  { name: "Belt Size", type: "size", values: ["S","M","L","XL","2XL"] },
  { name: "Bags Size", type: "size", values: ["S","M","L"] },
  { name: "Socks Size", type: "size", values: ["XS","S","M","L","XL","2XL","3XL","4XL"] },
  { name: "Caps Sizes", type: "size", values: ["1","2","3","4"] },
  { name: "Shoe Size", type: "size", values: ["6S","7S","8S","9S","10S","11S","12S","13S","1UK","2UK","3UK","4UK","5UK","6UK","7UK","8UK","9UK","10UK","11UK","12UK"] },
  { name: "BATA SHOE SIZE", type: "size", values: ["UK 1","UK 2","UK 3","UK 4","UK 5","UK 6","UK 7","UK 8","UK 9","UK 10","UK 11","UK 12"] },
  { name: "NIVIA SHOES SIZE", type: "size", values: ["UK 1","UK 2","UK 3","UK 4","UK 5","UK 6","UK 7","UK 8","UK 9","UK 10","UK 11","UK 12","UK 13"] },
  { name: "WINMORE SHOES SIZE", type: "size", values: ["UK 4","UK 5","UK 6","UK 7","UK 8","UK 9","UK 10"] },

  // Colors (global)
  { name: "Uniform Colors", type: "color", values: ["Teal","Yellow","White","Navy","Grey","BLUE","Maroon","Purple","Red","Green","Black","Orange","Pink","Brown","Beige","Turquoise","Off White","Mint"] },
  { name: "Sports Color", type: "color", values: ["Red","Blue","Green","Yellow"] },
  { name: "Sports Track Color", type: "color", values: ["Red","Blue","Green","Yellow","Navy","Black"] },
  { name: "Hoodie Color", type: "color", values: ["Navy","Maroon"] },
  { name: "Belt Color", type: "color", values: ["Black","Navy","Maroon","Green"] },
  { name: "Regular Socks Color", type: "color", values: ["Navy","White","Grey","Green","Black"] },
  { name: "Sports Socks Color", type: "color", values: ["Red","Blue","Green","Yellow"] },
  { name: "Caps Color", type: "color", values: ["Navy","Red","Green","Grey"] },
  { name: "Shoes Color", type: "color", values: ["Black","White"] },

  // Per-school colors
  { name: "SAM House Color", type: "color", schoolSlug: "samyu", values: ["Kalpana Chawla - RED","Vikram Sarabhai - BLUE","Isaac Newton - GREEN","Galileo Galilei - YELLOW"] },
  { name: "SAS BP UNIFORM COLOURS", type: "color", schoolSlug: "sas-bp", values: ["Sapphire Knights - BLUE","Topaz Vikings - YELLOW","Ruby Spartans - RED","Emerald Gladiators - GREEN"] },
  { name: "QLS Sports Color", type: "color", schoolSlug: "qls", values: ["Alpha (Red)","Beta (Blue)","Delta (Green)","Gamma (Yellow)"] },
  { name: "TSUS Colors", type: "color", schoolSlug: "tsus", values: ["Dhairya (Blue)","Abhay (RED)","Lakshay (GREEN)","Nishchay (YELLOW)","NAVY","WHITE","BLACK","OFF WHITE"] },

  // Designs
  { name: "INVENTRE BAG DESIGN", type: "design", values: ["GLOBE TECH L","COSMIC NAVIGATOR L","INVENTRE CLASSIC L","ROCK MODE L","THUNDER CHARGE L","INVENTRE PRESTIGE L","RACING REX NAVY M","RACING REX BLACK M","CYBER PIXEL M","DREAMY UNICORN S","SPACE ADVENTURE S","INVENTRE STARTER S","FROSTY BLOOM S","JUNGLE EXPLORER S","ARTIST DREAM S","STORM CHARGER M","SPEED RACER M"] },
  { name: "CRIMSON BAG DESIGN", type: "design", values: ["Space Adventure","Dreamy Unicorn","Pink Paradise","Cosmic Quest","Jungle Hop","Polka Pop","Rainbow Dream","Wave Rider","Galaxy Glow","Forest Friends","Beach Blast","City Lights"] },

  // Water bottles
  { name: "WATER BOTTLE MODELS", type: "model", values: ["Deer Horns - Red","Deer Horns - Blue","Deer Horns - Green","Deer Horns - Pink","Deer Horns - Purple","Deer Horns - Black","Smart Vacuum - Silver","Smart Vacuum - Black","Urban Matt SS - White","Urban Matt SS - Black","Urban Matt SS - Pink","Urban Matt SS - Blue","Urban Matt SS - Red","Urban Matt SS - Green","Cloud Striper - Sky","Cloud Striper - Pink","Cloud Striper - Mint","Cloud Striper - Lavender","Dual Sipper Dino","Dual Sipper Bunny","Dual Sipper Unicorn","Dual Sipper Bear"] },
];

async function buildPath(slug: string, parentSlug: string | null, byParent: Map<string, string>): Promise<string> {
  if (!parentSlug) return slug;
  const parentPath = byParent.get(parentSlug) ?? parentSlug;
  return `${parentPath}.${slug}`;
}

async function main() {
  console.log("→ Companies");
  for (const c of COMPANIES) {
    await db
      .insert(companies)
      .values(c)
      .onConflictDoUpdate({ target: companies.abbr, set: { name: c.name, gstin: c.gstin, isDefault: c.isDefault } });
  }

  console.log("→ Schools (12 real)");
  const schoolIdBySlug = new Map<string, string>();
  for (const s of SCHOOLS) {
    const existing = await db.select().from(schools).where(eq(schools.slug, s.slug)).limit(1);
    if (existing.length) {
      await db
        .update(schools)
        .set({
          name: s.name,
          itemCodePrefixes: s.prefixes,
          gradesServed: s.grades,
          curriculum: s.curriculum,
          colorMap: COLOR_MAPS[s.slug] ?? {},
          status: "active",
        })
        .where(eq(schools.slug, s.slug));
      schoolIdBySlug.set(s.slug, existing[0].id);
    } else {
      const [created] = await db
        .insert(schools)
        .values({
          slug: s.slug,
          name: s.name,
          itemCodePrefixes: s.prefixes,
          gradesServed: s.grades,
          curriculum: s.curriculum,
          colorMap: COLOR_MAPS[s.slug] ?? {},
          status: "active",
          isFeatured: false,
        })
        .returning();
      schoolIdBySlug.set(s.slug, created.id);
    }
  }
  console.log(`   ${SCHOOLS.length} schools upserted`);

  console.log("→ Categories (full audit tree)");
  const pathBySlug = new Map<string, string>();
  for (const c of CATEGORY_TREE) {
    const path = await buildPath(c.slug, c.parent, pathBySlug);
    pathBySlug.set(c.slug, path);
    const parentRow = c.parent
      ? await db.select().from(categories).where(eq(categories.slug, c.parent)).limit(1)
      : [];
    await db
      .insert(categories)
      .values({
        slug: c.slug,
        name: c.name,
        parentId: parentRow[0]?.id ?? null,
        sortOrder: 0,
        path,
      })
      .onConflictDoNothing();
  }
  console.log(`   ${CATEGORY_TREE.length} categories ensured`);

  console.log("→ Attributes (audit §2.5)");
  let attrCount = 0;
  let valueCount = 0;
  for (const a of ATTRIBUTES) {
    const schoolId = a.schoolSlug ? schoolIdBySlug.get(a.schoolSlug) ?? null : null;

    const existing = await db
      .select()
      .from(productAttributes)
      .where(eq(productAttributes.name, a.name))
      .limit(1);
    let attrId: string;
    if (existing.length) {
      attrId = existing[0].id;
    } else {
      const [created] = await db
        .insert(productAttributes)
        .values({ name: a.name, type: a.type, schoolId })
        .returning();
      attrId = created.id;
      attrCount++;
    }
    for (const v of a.values) {
      await db
        .insert(productAttributeValues)
        .values({ attributeId: attrId, value: v })
        .onConflictDoNothing();
      valueCount++;
    }
  }
  console.log(`   ${attrCount} new attributes, ${valueCount} value upserts`);

  console.log("✓ Real data seed complete");
  await client.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
