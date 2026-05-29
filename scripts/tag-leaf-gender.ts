/* eslint-disable no-console */
/**
 * Tags leaf product gender for gender-specific garments so the shop hides
 * Skort/Skirt/Girls items from male students and Boys items from female.
 *
 * Rules (name-pattern based; conservative — items not matched stay null/unisex):
 *   /skort|\bskirt|\bgirls?\b/i  → Girls
 *   /\bboys?\b/i                 → Boys
 *
 * Idempotent — re-running just re-applies the same regex.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { db } from "../db/client";
import { sql } from "drizzle-orm";

async function main() {
  // Mark leaves whose name says Girls (incl. skort/skirt)
  const girls = (await db.execute(sql`
    UPDATE products
       SET bundle_gender = 'Girls'
     WHERE bundle_level = 'leaf'
       AND bundle_gender IS NULL
       AND (name ~* 'skort' OR name ~* '\\mskirt\\M' OR name ~* '\\mgirls?\\M')
  `)) as unknown as { count?: number };

  // Mark leaves whose name says Boys (but not "Big Boys" type compound names; the simple Boys regex covers them OK)
  const boys = (await db.execute(sql`
    UPDATE products
       SET bundle_gender = 'Boys'
     WHERE bundle_level = 'leaf'
       AND bundle_gender IS NULL
       AND name ~* '\\mboys?\\M'
  `)) as unknown as { count?: number };

  console.log(`Tagged Girls: ${girls.count ?? 0}, Boys: ${boys.count ?? 0}`);

  // Show what got tagged
  const sample = (await db.execute(sql`
    SELECT bundle_gender, name FROM products
     WHERE bundle_level='leaf' AND bundle_gender IS NOT NULL
     ORDER BY bundle_gender, name LIMIT 20
  `)) as unknown as { bundle_gender: string; name: string }[];
  console.log("Sample:");
  for (const r of sample) console.log(`  [${r.bundle_gender}] ${r.name}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
