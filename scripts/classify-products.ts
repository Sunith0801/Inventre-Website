/**
 * Classifies every product in DB by BOM-hierarchy position, based on
 * the human-readable name pattern. Writes `bundle_level`, `bundle_gender`,
 * and `is_magic_box` columns. Idempotent — safe to re-run.
 *
 *   magic_box   → name contains "Magic Box"
 *   bookkit     → name contains "Bookkit"
 *   sub_bundle  → name contains "Bundle <N>" (e.g. Bundle 13 Notebook)
 *   leaf        → everything else
 *
 * Gender extraction for Magic Box:
 *   "WM JK Magic Box Girls Grade 9" → "Girls"
 *   "WM JK Magic Box Boys UKG"      → "Boys"
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { products } from "../db/schema";
import { sql } from "drizzle-orm";

type Level = "magic_box" | "bookkit" | "sub_bundle" | "leaf";
type Gender = "Boys" | "Girls" | null;

function classify(name: string): { level: Level; gender: Gender } {
  if (/magic\s*box/i.test(name)) {
    const m = name.match(/\b(boys|girls)\b/i);
    const gender = m ? ((m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as Gender) : null;
    return { level: "magic_box", gender };
  }
  if (/bookkit/i.test(name)) return { level: "bookkit", gender: null };
  if (/\bbundle\s*\d+/i.test(name)) return { level: "sub_bundle", gender: null };
  return { level: "leaf", gender: null };
}

async function main() {
  const rows = await db.select({ id: products.id, name: products.name }).from(products);
  console.log(`Classifying ${rows.length} products...`);

  const counts: Record<Level, number> = { magic_box: 0, bookkit: 0, sub_bundle: 0, leaf: 0 };
  let updated = 0;

  for (const r of rows) {
    const { level, gender } = classify(r.name);
    counts[level]++;
    await db.execute(sql`
      UPDATE products
         SET bundle_level   = ${level}::bundle_level,
             bundle_gender  = ${gender},
             is_magic_box   = ${level === "magic_box"}
       WHERE id = ${r.id}
    `);
    updated++;
    if (updated % 250 === 0) process.stdout.write(`  ${updated}/${rows.length}\r`);
  }
  console.log(`\nDone. Updated ${updated} rows.`);
  console.log("By level:", counts);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
