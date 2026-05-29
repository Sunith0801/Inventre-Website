/* eslint-disable no-console */
/**
 * Backfill productSchool rows for ERP-imported items based on item_code prefix.
 *
 * The original migration (04-items.ts) only linked products to schools when
 * `custom_school_name` was set in ERPNext — but per audit §11, that field is
 * often empty. As a result, many imported products don't have a productSchool
 * row, which means they DON'T appear on the shop catalog (which INNER JOINs
 * productSchool).
 *
 * This script fixes that by matching `products.itemCode` prefixes against
 * `schools.itemCodePrefixes`. E.g. an item "KLS Boys Shirt" gets linked to
 * the school whose prefixes include "KLS".
 *
 *   npx tsx scripts/backfill-product-school.ts
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { products, schools, productSchool } from "../db/schema";
import * as schema from "../db/schema";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

async function main() {
  console.log("\nBackfilling productSchool from item_code prefixes\n");

  // Pull all schools with their prefixes
  const allSchools = await db.select().from(schools);
  const prefixSchools = allSchools
    .map((s) => ({
      id: s.id,
      name: s.name,
      prefixes: (s.itemCodePrefixes ?? []) as string[],
    }))
    .filter((s) => s.prefixes.length > 0)
    .sort((a, b) => {
      // Longest prefix first so "SAS BP" matches before "SAS"
      const maxA = Math.max(...a.prefixes.map((p) => p.length));
      const maxB = Math.max(...b.prefixes.map((p) => p.length));
      return maxB - maxA;
    });

  console.log(`  ${prefixSchools.length} schools with prefixes`);

  // Pull all products that have an itemCode but no productSchool row
  const orphans = await db
    .select()
    .from(products)
    .where(
      and(
        isNotNull(products.itemCode),
        sql`NOT EXISTS (SELECT 1 FROM ${productSchool} ps WHERE ps.product_id = ${products.id})`
      )
    );

  console.log(`  ${orphans.length} products without a school link`);

  let linked = 0;
  let unmatched = 0;
  const sampleUnmatched: string[] = [];

  for (const p of orphans) {
    if (!p.itemCode) continue;
    let matched = false;
    for (const s of prefixSchools) {
      const hit = s.prefixes.find((pref) =>
        p.itemCode!.toLowerCase().startsWith(pref.toLowerCase() + " ") ||
        p.itemCode!.toLowerCase() === pref.toLowerCase()
      );
      if (hit) {
        await db
          .insert(productSchool)
          .values({ productId: p.id, schoolId: s.id, isRequired: false })
          .onConflictDoNothing();
        linked++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      unmatched++;
      if (sampleUnmatched.length < 10) sampleUnmatched.push(p.itemCode);
    }
    if ((linked + unmatched) % 50 === 0) {
      console.log(`  progress: ${linked} linked, ${unmatched} unmatched`);
    }
  }

  console.log(`\n✓ done — ${linked} linked, ${unmatched} unmatched`);
  if (sampleUnmatched.length > 0) {
    console.log(`  sample unmatched item codes:`);
    sampleUnmatched.forEach((c) => console.log(`    ${c}`));
    console.log(`  (these don't match any school's itemCodePrefixes — check schools admin)`);
  }
  await client.end();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await client.end();
  process.exit(1);
});
