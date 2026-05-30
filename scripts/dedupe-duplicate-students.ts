/* eslint-disable no-console */
/**
 * Dedupe duplicate `students` rows. Identifies pairs sharing the same
 * `enrollment_number`, picks a winner per the rules below, reassigns
 * every FK reference to the winner, merges missing fields onto the
 * winner, deletes the loser.
 *
 * Survivor rules (in order):
 *   1. erp_name LIKE 'MCB-%' wins.
 *   2. else erp_name LIKE 'ADMIN-%'.
 *   3. else most-recent synced_at.
 *   4. else most-recent created_at.
 *
 * After dedupe, run `scripts/sync-students-grade-from-mcb.ts` again to
 * pull the latest MCB grade onto the surviving rows.
 *
 *   npx tsx scripts/dedupe-duplicate-students.ts            # dry-run
 *   npx tsx scripts/dedupe-duplicate-students.ts --apply
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

const FK_TABLES = [
  "carts",
  "cart_items",
  "orders",
  "product_drafts",
  "reviews",
  "student_addresses",
  "student_guardian_links",
  "student_siblings",
  "website_cart_coupons",
  "wishlists",
];

async function main() {
  console.log(`\nDedupe duplicate students.id (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  // Pairs — for each duplicate enrolment, pick winner using survivor rules.
  const rawPairs = (await db.execute(sql`
    WITH ranked AS (
      SELECT id, enrollment_number, erp_name, first_name, last_name, name,
             parent_id, school_id, synced_at, created_at,
             ROW_NUMBER() OVER (
               PARTITION BY enrollment_number
               ORDER BY
                 CASE
                   WHEN erp_name LIKE 'MCB-%' THEN 1
                   WHEN erp_name LIKE 'ADMIN-%' THEN 2
                   ELSE 3
                 END,
                 synced_at DESC NULLS LAST,
                 created_at DESC NULLS LAST
             ) AS rn
        FROM students
       WHERE enrollment_number IS NOT NULL
         AND enrollment_number IN (
           SELECT enrollment_number FROM students
            WHERE enrollment_number IS NOT NULL
            GROUP BY enrollment_number HAVING COUNT(*) > 1
         )
    )
    SELECT
      MAX(CASE WHEN rn=1 THEN id::text END)        AS winner_id,
      MAX(CASE WHEN rn=2 THEN id::text END)        AS loser_id,
      MAX(CASE WHEN rn=1 THEN enrollment_number END) AS enrolment,
      MAX(CASE WHEN rn=1 THEN COALESCE(erp_name,'') END)        AS winner_erp,
      MAX(CASE WHEN rn=2 THEN COALESCE(erp_name,'') END)        AS loser_erp,
      MAX(CASE WHEN rn=1 THEN COALESCE(first_name,name,'') END) AS winner_name,
      MAX(CASE WHEN rn=2 THEN COALESCE(first_name,name,'') END) AS loser_name
      FROM ranked
     GROUP BY enrollment_number
     ORDER BY enrollment_number
  `)) as unknown as {
    winner_id: string;
    loser_id: string;
    enrolment: string;
    winner_erp: string;
    loser_erp: string;
    winner_name: string;
    loser_name: string;
  }[];

  // Name-similarity guard. Normalise (lowercase, strip non-letters), then
  // require the first 4 letters to match, OR one name to be a substring of
  // the other. Anchal vs Sravanthi fails — kept as anomaly, not merged.
  function nameKey(s: string): string {
    return (s || "").toLowerCase().replace(/[^a-z]/g, "");
  }
  function namesLikelyMatch(a: string, b: string): boolean {
    const A = nameKey(a), B = nameKey(b);
    if (!A || !B) return false;
    if (A === B) return true;
    if (A.length >= 4 && B.length >= 4 && A.slice(0, 4) === B.slice(0, 4)) return true;
    if (A.includes(B) || B.includes(A)) return true;
    return false;
  }

  const pairs: typeof rawPairs = [];
  const anomalies: typeof rawPairs = [];
  for (const p of rawPairs) {
    if (namesLikelyMatch(p.winner_name, p.loser_name)) pairs.push(p);
    else anomalies.push(p);
  }

  console.log(`  ${pairs.length} duplicate pairs to merge`);
  console.log(`  ${anomalies.length} pairs SKIPPED — names don't match (different students sharing an enrolment)\n`);
  if (anomalies.length > 0) {
    console.log(`  Anomalies (first 20):`);
    for (const a of anomalies.slice(0, 20)) {
      console.log(`    ${a.enrolment.padEnd(12)} "${a.winner_name}" vs "${a.loser_name}"`);
    }
    if (anomalies.length > 20) console.log(`    ... and ${anomalies.length - 20} more`);
    console.log("");
  }
  console.log(`  Merge sample (first 10):`);
  for (const p of pairs.slice(0, 10)) {
    console.log(`    ${p.enrolment.padEnd(12)} ${p.winner_name.padEnd(28)} winner=${p.winner_erp.slice(0, 38).padEnd(40)} loser=${p.loser_erp.slice(0, 38)}`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — re-run with --apply to commit.\n`);
    return;
  }

  // One transaction for the whole batch — atomic.
  await db.transaction(async (tx) => {
    // Build temp table with winner/loser pairs.
    await tx.execute(sql`
      CREATE TEMP TABLE _dedupe_pairs (winner_id uuid NOT NULL, loser_id uuid NOT NULL) ON COMMIT DROP
    `);
    for (const p of pairs) {
      await tx.execute(sql`INSERT INTO _dedupe_pairs VALUES (${p.winner_id}::uuid, ${p.loser_id}::uuid)`);
    }

    // Field merge: copy non-null loser values into winner where winner is null.
    // Only safe-to-merge fields. Skip id, enrollment_number, erp_name, created_at.
    const MERGE_FIELDS = [
      "first_name","middle_name","last_name","name","grade","class","section",
      "gender","date_of_birth","blood_group","nationality","house_color","medium",
      "curriculum","shoe_size","shirt_size","trouser_size",
      "student_email_id","student_mobile_number",
      "joining_date","is_verified","is_new_student",
      "parent_id","school_id","school_code","customer_link",
    ];
    for (const f of MERGE_FIELDS) {
      await tx.execute(sql.raw(`
        UPDATE students w
           SET ${f} = l.${f}
          FROM _dedupe_pairs p
          JOIN students l ON l.id = p.loser_id
         WHERE w.id = p.winner_id
           AND w.${f} IS NULL
           AND l.${f} IS NOT NULL
      `));
    }

    // Reassign FK references from loser → winner.
    // student_guardian_links has a partial unique on
    // (student_id, normalized phone) — drop any loser row whose phone
    // already exists on the winner BEFORE reassigning. Otherwise the
    // UPDATE collides.
    await tx.execute(sql`
      DELETE FROM student_guardian_links l
       USING _dedupe_pairs p
       WHERE l.student_id = p.loser_id
         AND EXISTS (
           SELECT 1 FROM student_guardian_links w
            WHERE w.student_id = p.winner_id
              AND right(regexp_replace(coalesce(w.phone_no,''),'\\D','','g'),10)
                = right(regexp_replace(coalesce(l.phone_no,''),'\\D','','g'),10)
         )
    `);

    for (const t of FK_TABLES) {
      const r = await tx.execute(sql.raw(`
        UPDATE ${t} SET student_id = p.winner_id
          FROM _dedupe_pairs p
         WHERE ${t}.student_id = p.loser_id
      `));
      console.log(`    reassigned ${t}`);
      void r;
    }

    // Delete losers.
    await tx.execute(sql`DELETE FROM students WHERE id IN (SELECT loser_id FROM _dedupe_pairs)`);
  });

  console.log(`\nApplied. ${pairs.length} duplicate students.id pairs deduped.\n`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
