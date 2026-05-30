/* eslint-disable no-console */
/**
 * Re-flag `students.is_new_student` for 5 specific schools based on the 2026
 * enrollment-number prefix(es) per school. Everything matching a "new" prefix
 * becomes is_new_student=true; everything else in those schools becomes
 * is_new_student=false. All OTHER schools are left untouched.
 *
 *   DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
 *     npx tsx scripts/reflag-new-students-2026.ts [--dry-run]
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const DRY_RUN = process.argv.includes("--dry-run");

const RULES: { schoolCode: string; label: string; newPrefixes: string[] }[] = [
  { schoolCode: "WMAJK", label: "Winmore Academy Jakkur",      newPrefixes: ["26WMJK%"] },
  { schoolCode: "WMAWF", label: "Winmore Academy Whitefield",  newPrefixes: ["26WMWF%"] },
  { schoolCode: "SMSAW", label: "St Michaels School Alwal",    newPrefixes: ["26SMS%", "AW26%"] },
  { schoolCode: "SASBP", label: "St Andrews Suchitra",         newPrefixes: ["26BP%", "SC26%"] },
  { schoolCode: "SASKS", label: "St Andrews Keesara",          newPrefixes: ["26KS%", "KS26%"] },
];

type CountRow = { is_new_student: boolean; n: string };

async function countsFor(schoolCode: string): Promise<{ trueCount: number; falseCount: number }> {
  const rows = (await db.execute(sql`
    SELECT is_new_student, COUNT(*)::text AS n
      FROM students
     WHERE school_code = ${schoolCode}
     GROUP BY is_new_student
  `)) as unknown as CountRow[];
  let t = 0, f = 0;
  for (const r of rows) {
    if (r.is_new_student) t = Number(r.n);
    else f = Number(r.n);
  }
  return { trueCount: t, falseCount: f };
}

function likeAny(prefixes: string[]) {
  // Build (enrollment_number LIKE $1 OR enrollment_number LIKE $2 ...)
  const parts = prefixes.map((p) => sql`enrollment_number LIKE ${p}`);
  return sql.join(parts, sql` OR `);
}

async function matchCount(schoolCode: string, prefixes: string[]): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::text AS n
      FROM students
     WHERE school_code = ${schoolCode}
       AND (${likeAny(prefixes)})
  `)) as unknown as { n: string }[];
  return Number(rows[0]?.n ?? 0);
}

async function main() {
  console.log(`\nReflag is_new_student for 2026 cohort  (${DRY_RUN ? "DRY RUN" : "APPLY"})\n`);

  await db.execute(sql`BEGIN`);
  try {
    for (const rule of RULES) {
      const before = await countsFor(rule.schoolCode);
      const expectedNew = await matchCount(rule.schoolCode, rule.newPrefixes);

      console.log(`── ${rule.schoolCode}  ${rule.label}`);
      console.log(`   prefixes for "new": ${rule.newPrefixes.join(", ")}`);
      console.log(`   before:  is_new=true ${before.trueCount}   is_new=false ${before.falseCount}`);
      console.log(`   rows matching new-prefixes: ${expectedNew}`);

      const setTrue = await db.execute(sql`
        UPDATE students
           SET is_new_student = true
         WHERE school_code = ${rule.schoolCode}
           AND (${likeAny(rule.newPrefixes)})
           AND is_new_student IS DISTINCT FROM true
      `);
      const setFalse = await db.execute(sql`
        UPDATE students
           SET is_new_student = false
         WHERE school_code = ${rule.schoolCode}
           AND NOT (${likeAny(rule.newPrefixes)})
           AND is_new_student IS DISTINCT FROM false
      `);

      const flippedToTrue = (setTrue as unknown as { count: number }).count ?? 0;
      const flippedToFalse = (setFalse as unknown as { count: number }).count ?? 0;
      console.log(`   flipped → true:  ${flippedToTrue}`);
      console.log(`   flipped → false: ${flippedToFalse}`);

      const after = await countsFor(rule.schoolCode);
      console.log(`   after:   is_new=true ${after.trueCount}   is_new=false ${after.falseCount}`);

      if (after.trueCount !== expectedNew) {
        console.log(`   ⚠️  mismatch: after.true=${after.trueCount} but expected=${expectedNew}`);
      }
      console.log("");
    }

    if (DRY_RUN) {
      await db.execute(sql`ROLLBACK`);
      console.log("DRY RUN — rolled back. No changes persisted.\n");
    } else {
      await db.execute(sql`COMMIT`);
      console.log("Committed.\n");
    }
  } catch (e) {
    await db.execute(sql`ROLLBACK`);
    throw e;
  }
}

main()
  .then(() => client.end())
  .catch((e) => {
    console.error(e);
    return client.end().then(() => process.exit(1));
  });
