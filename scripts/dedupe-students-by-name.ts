/* eslint-disable no-console */
/**
 * Second-pass dedupe — collapses students who exist as multiple rows at
 * the SAME school with the SAME normalized name but DIFFERENT
 * enrollment numbers (the cross-system pattern: ERP import created one
 * row, MCB grant created another with a different enrolment format).
 *
 * Survivor rule:
 *   1. MCB-prefixed (erp_name LIKE 'MCB-%') wins — it has the up-to-date
 *      grade pulled from mcb_students by the earlier sync.
 *   2. else ADMIN-prefixed.
 *   3. else most-recent synced_at, then created_at.
 *
 * The loser's FK references are pointed at the winner. Field merge: any
 * column NULL on the winner is filled from the loser. The winner's
 * existing values are NEVER overwritten — so the MCB-correct grade
 * survives.
 *
 *   npx tsx scripts/dedupe-students-by-name.ts            # dry-run
 *   npx tsx scripts/dedupe-students-by-name.ts --apply
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
  "carts","cart_items","orders","product_drafts","reviews",
  "student_addresses","student_guardian_links","student_siblings",
  "website_cart_coupons","wishlists",
];

async function main() {
  console.log(`\nName-based dedupe ${APPLY ? "(APPLY)" : "(DRY-RUN)"}\n`);

  // Per (school_id, normalized first_name), rank rows by the survivor rule.
  // Only consider rows where normalized name is at least 4 chars (avoids
  // false matches on AA / AAA / placeholders).
  const pairsRaw = await db.execute(sql`
    WITH norm AS (
      SELECT id, school_id, school_code, enrollment_number, first_name, name, grade,
             erp_name, synced_at, created_at,
             lower(regexp_replace(coalesce(first_name, name, ''), '[^a-z]', '', 'gi')) AS nk
        FROM students WHERE enabled = true
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY school_id, nk
        ORDER BY
          CASE
            WHEN erp_name LIKE 'MCB-%' THEN 1
            WHEN erp_name LIKE 'ADMIN-%' THEN 2
            ELSE 3
          END,
          synced_at DESC NULLS LAST,
          created_at DESC NULLS LAST
      ) AS rn,
      COUNT(*) OVER (PARTITION BY school_id, nk) AS group_size
        FROM norm WHERE length(nk) >= 4
    )
    SELECT id::text AS row_id, school_id::text AS sid, school_code, enrollment_number, first_name, nk, grade, erp_name, rn, group_size
      FROM ranked WHERE group_size > 1 AND group_size <= 2
     ORDER BY school_id, nk, rn
  `);
  console.log(`  raw rows from query: ${(pairsRaw as unknown[]).length ?? "?"}`);
  const pairs = (Array.isArray(pairsRaw) ? pairsRaw : ((pairsRaw as { rows?: unknown[] }).rows ?? [])) as {
    row_id: string;
    sid: string;
    school_code: string;
    enrollment_number: string;
    first_name: string;
    nk: string;
    grade: string | null;
    erp_name: string;
    rn: number | string;
    group_size: number | string;
  }[];

  // Bucket into winner/loser pairs. Key on (school_id, normalized nk) — NOT
  // first_name — so "B GNANVIKA" and "B.GNANVIKA" land in the same bucket.
  type Bucket = {
    winner_id: string; winner_grade: string | null; winner_src: string;
    loser_id: string;  loser_grade: string | null;  loser_src: string;
    name: string; school: string;
  };
  const groups = new Map<string, Bucket>();
  for (const r of pairs) {
    const key = `${r.sid}::${r.nk}`;
    const rn = typeof r.rn === "string" ? parseInt(r.rn, 10) : r.rn;
    const src = r.erp_name?.startsWith("MCB-") ? "MCB" : r.erp_name?.startsWith("ADMIN-") ? "ADMIN" : "other";
    if (rn === 1) {
      const cur = groups.get(key) ?? { winner_id: "", winner_grade: null, winner_src: "", loser_id: "", loser_grade: null, loser_src: "", name: r.first_name, school: r.school_code };
      cur.winner_id = r.row_id; cur.winner_grade = r.grade; cur.winner_src = src;
      groups.set(key, cur);
    } else if (rn === 2) {
      const cur = groups.get(key) ?? { winner_id: "", winner_grade: null, winner_src: "", loser_id: "", loser_grade: null, loser_src: "", name: r.first_name, school: r.school_code };
      cur.loser_id = r.row_id; cur.loser_grade = r.grade; cur.loser_src = src;
      groups.set(key, cur);
    }
  }

  // Auto-merge when grades match (same school + same name + same grade =
  // very likely the same student). Different grades are left for review
  // — they're more likely siblings or namesakes.
  const ready = [...groups.values()].filter((g) =>
    g.winner_id && g.loser_id && g.winner_grade === g.loser_grade
  );
  const skipped = [...groups.values()].filter((g) =>
    g.winner_id && g.loser_id && g.winner_grade !== g.loser_grade
  );
  console.log(`  ${ready.length} pairs to merge (same grade + MCB-prefixed on one side)`);
  console.log(`  ${skipped.length} pairs SKIPPED — different grades or no MCB anchor (likely namesakes)\n`);
  console.log(`  Merging:`);
  for (const g of ready.slice(0, 15)) {
    console.log(`    ${g.school.padEnd(13)} ${g.name.padEnd(34)} ${g.winner_grade ?? "—"} [${g.winner_src} kept]`);
  }
  if (ready.length > 15) console.log(`    ... and ${ready.length - 15} more\n`);
  if (skipped.length > 0) {
    console.log(`  Skipped (need manual review):`);
    for (const g of skipped.slice(0, 20)) {
      console.log(`    ${g.school.padEnd(13)} ${g.name.padEnd(34)} ${g.winner_grade ?? "—"} vs ${g.loser_grade ?? "—"}`);
    }
    if (skipped.length > 20) console.log(`    ... and ${skipped.length - 20} more`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — re-run with --apply to commit.\n`);
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`CREATE TEMP TABLE _dedupe_pairs (winner_id uuid NOT NULL, loser_id uuid NOT NULL) ON COMMIT DROP`);
    for (const g of ready) {
      await tx.execute(sql`INSERT INTO _dedupe_pairs VALUES (${g.winner_id}::uuid, ${g.loser_id}::uuid)`);
    }

    // Field merge — copy loser → winner ONLY for columns that are null
    // on the winner. The winner's MCB-correct grade is preserved.
    const MERGE_FIELDS = [
      "first_name","middle_name","last_name","name","grade","class","section",
      "gender","date_of_birth","blood_group","nationality","house_color","medium",
      "curriculum","shoe_size","shirt_size","trouser_size",
      "student_email_id","student_mobile_number","joining_date",
      "parent_id","customer_link",
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

    // Guardian-link partial unique on normalized phone.
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
    // product_drafts: PK on (parent_id, product_id, COALESCE(student_id,…)).
    // If the winner already has a draft for the same parent_id+product_id,
    // drop the loser's draft.
    await tx.execute(sql`
      DELETE FROM product_drafts l
       USING _dedupe_pairs p
       WHERE l.student_id = p.loser_id
         AND EXISTS (
           SELECT 1 FROM product_drafts w
            WHERE w.student_id = p.winner_id
              AND w.parent_id = l.parent_id
              AND w.product_id = l.product_id
         )
    `);
    // carts: typically one cart per (parent_id, student_id). If both rows
    // had a cart, keep the winner's, drop the loser's.
    await tx.execute(sql`
      DELETE FROM cart_items WHERE cart_id IN (
        SELECT c.id FROM carts c JOIN _dedupe_pairs p ON c.student_id = p.loser_id
         WHERE EXISTS (SELECT 1 FROM carts c2 WHERE c2.student_id = p.winner_id)
      )
    `);
    await tx.execute(sql`
      DELETE FROM carts c USING _dedupe_pairs p
       WHERE c.student_id = p.loser_id
         AND EXISTS (SELECT 1 FROM carts c2 WHERE c2.student_id = p.winner_id)
    `);
    // wishlists: similar — keep winner's, drop loser's if both have one.
    await tx.execute(sql`
      DELETE FROM wishlists w USING _dedupe_pairs p
       WHERE w.student_id = p.loser_id
         AND EXISTS (SELECT 1 FROM wishlists w2 WHERE w2.student_id = p.winner_id)
    `);

    for (const t of FK_TABLES) {
      await tx.execute(sql.raw(`
        UPDATE ${t} SET student_id = p.winner_id
          FROM _dedupe_pairs p
         WHERE ${t}.student_id = p.loser_id
      `));
      console.log(`    reassigned ${t}`);
    }

    await tx.execute(sql`DELETE FROM students WHERE id IN (SELECT loser_id FROM _dedupe_pairs)`);
  });

  console.log(`\nApplied. ${ready.length} duplicate rows merged.\n`);
}

main().then(() => client.end()).catch((e) => { console.error(e); return client.end().then(() => process.exit(1)); });
