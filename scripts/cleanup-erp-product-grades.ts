/* eslint-disable no-console */
/**
 * Phase A2 — rewrite `product_grades.grade` ERP-uniform values
 * (Grade 13/14/15, plus DSE variants) to CBSE (Grade 10/11/12).
 *
 * Per-product duplicate handling:
 *   - If the product already has a tag at the CBSE target (e.g. both
 *     Grade 10 and Grade 13), DELETE the ERP row.
 *   - If only the ERP row exists, UPDATE its grade column to CBSE.
 *
 * DSE variants are renamed in lockstep ("Grade 13 DSE" → "Grade 10 DSE").
 *
 *   npx tsx scripts/cleanup-erp-product-grades.ts             # dry-run
 *   npx tsx scripts/cleanup-erp-product-grades.ts --apply     # commit
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";

const APPLY = process.argv.includes("--apply");

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const PAIRS: { from: string; to: string }[] = [
  { from: "Grade 13", to: "Grade 10" },
  { from: "Grade 14", to: "Grade 11" },
  { from: "Grade 15", to: "Grade 12" },
  { from: "Grade 13 DSE", to: "Grade 10 DSE" },
  // DSE rows for 11 / 12 / pre-primary were sparse but include for completeness.
];

async function main() {
  console.log(`\nCleanup ERP-uniform product_grades (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  for (const { from, to } of PAIRS) {
    const ergRows = (await db.execute(sql`
      SELECT product_id FROM product_grades WHERE grade = ${from}
    `)) as unknown as { product_id: string }[];
    if (ergRows.length === 0) {
      console.log(`  ${from}: none — skip`);
      continue;
    }
    const productIds = ergRows.map((r) => r.product_id);
    const dupRows = (await db.execute(sql`
      SELECT product_id FROM product_grades
       WHERE grade = ${to}
         AND product_id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
    `)) as unknown as { product_id: string }[];
    const dupSet = new Set(dupRows.map((r) => r.product_id));
    const toDelete = productIds.filter((id) => dupSet.has(id));
    const toRewrite = productIds.filter((id) => !dupSet.has(id));
    console.log(`  ${from} → ${to}: ${productIds.length} total — delete ${toDelete.length} dups, rewrite ${toRewrite.length}`);
    if (!APPLY) continue;
    if (toDelete.length > 0) {
      await db.execute(sql`
        DELETE FROM product_grades
         WHERE grade = ${from}
           AND product_id IN (${sql.join(toDelete.map((id) => sql`${id}`), sql`, `)})
      `);
    }
    if (toRewrite.length > 0) {
      await db.execute(sql`
        UPDATE product_grades SET grade = ${to}
         WHERE grade = ${from}
           AND product_id IN (${sql.join(toRewrite.map((id) => sql`${id}`), sql`, `)})
      `);
    }
  }

  console.log(APPLY ? "\nApplied.\n" : "\nDRY-RUN — re-run with --apply to commit.\n");
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
